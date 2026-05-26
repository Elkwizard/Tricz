import { styleText } from "node:util";
import { AST } from "./ast.mjs";
import { ArrayType, PointerType, PrimitiveType } from "./types.mjs";
import Visitor from "/G:/My Drive/Desktop/Pipelang2/visitor.mjs";
import ValueMap from "/G:/My Drive/Desktop/Pipelang2/util/valueMap.mjs";
import { Add, Address, Call, Copy, Constant, Jump, Label, Load, Multiply, Negate, Register, Return, Store, Divide, List, Remainder, CompareJump, LabelDecl, Push, Pop } from "./ir.mjs";

const { make } = AST;

// representation of a parameter-type/index
class ParamSpec {
    constructor(index, type) {
        this.index = index;
        this.type = type;
    }
    equals(other) {
        return this.index === other.index &&
            this.type.equals(other.type);
    }
}

class Exp {
    constructor(value, stmts = []) {
        this.value = value;
        this.stmts = stmts;
    }
    copyInto(reg) {
        return [
            ...this.stmts,
            new Copy(this.value).into(reg)
        ];
    }
    toString() {
        if (!this.stmts.length) return this.value.toString();

        return `${this.value} of {\n${this.stmts
            .map(stmt => `\t${stmt}`)
            .join("\n")
            }\n}`;
    }
    static merge(fn, ...exps) {
        let merged = fn(...exps.map(e => e.value));

        if (!(merged instanceof Exp))
            merged = new Exp(merged, []);

        return new Exp(
            merged.value,
            [...exps, merged].flatMap(exp => exp.stmts)
        );
    }
    // applies a three address code to some number of expressions
    static of(Instruction, type, ...exps) {
        const temp = new Register(type, false, Instruction.name);
        return Exp.merge(
            (...values) => new Exp(temp, [
                new Instruction(...values).into(temp)
            ]),
            ...exps
        );
    }
}

// generates code for the address of an expression
class AddrGenerator extends Visitor {
    constructor(ir) {
        super();
        this.ir = ir;
    }
    Call(node) {
        return Exp.merge(
            returnReg => new Address(returnReg),
            this.ir.visit(node)
        );
    }
    Reference(node) {
        return new Exp(new Address(node._decl._reg));
    }
    Dereference(node) {
        return this.ir.visit(node.target);
    }
    Subscript(node) {
        const elementSize = node._type.size;
        const product = new Register(PrimitiveType.INT, false, "[*]");
        const sum = new Register(new PointerType(node._type), false, "[+]");

        return Exp.merge(
            (arrAddr, index) => new Exp(sum, [
                new Multiply(index, new Constant(elementSize)).into(product),
                new Add(arrAddr, product).into(sum)
            ]),
            this.visit(node.arr),
            this.ir.visit(node.index)
        );
    }
}

// generates code for jumping based on an expression
class JumpGenerator extends Visitor {
    constructor(ir) {
        super();
        this.ir = ir;
        this.jumpStates = [];
    }
    get ifTrue() {
        return this.jumpStates.at(-1).ifTrue;
    }
    get ifFalse() {
        return this.jumpStates.at(-1).ifFalse;
    }
    visit(node, ifTrue, ifFalse) {
        this.jumpStates.push({ ifTrue, ifFalse });
        const result = super.visit(node);
        this.jumpStates.pop();
        return result;
    }
    Bool(bool) {
        return [new Jump(
            bool.value === "true" ? this.ifTrue : this.ifFalse
        )];
    }
    Logic(logic) {
        const afterFirst = new Label();
        switch (logic.op) {
            case "&&": return [
                ...this.visit(logic.left, afterFirst, this.ifFalse),
                new LabelDecl(afterFirst),
                ...this.visit(logic.right, this.ifTrue, this.ifFalse)
            ];
        }

        logic.error(`MISSING LOGIC ` + logic.op);
    }
    Compare(node) {
        const flipped = Exp.of(
            Negate, node.right._targetType,
            this.ir.visit(node.right)
        );
        const diff = Exp.of(
            Add, node.right._targetType,
            this.ir.visit(node.left),
            flipped
        );

        return [
            ...diff.stmts,
            new CompareJump(
                diff.value, node.op,
                this.ifTrue
            ),
            new Jump(this.ifFalse)
        ];
    }
}

// generates code for the value of an expression
class IRGenerator extends Visitor {
    constructor(config) {
        super();
        this.fixedFactor = 10 ** config.fixedPrecision;
        this.fixedFactorExp = new Exp(new Constant(this.fixedFactor));
        this.index = 0;
        this.addr = new AddrGenerator(this);
        this.jump = new JumpGenerator(this);
        this.returnRegisters = new ValueMap();
        this.paramRegisters = new ValueMap();
    }
    getParamRegister(spec) {
        if (!this.paramRegisters.has(spec))
            this.paramRegisters.set(spec, new Register(spec.type, true, `p${spec.index}`));

        return this.paramRegisters.get(spec);
    }
    getReturnRegister(type) {
        if (!this.returnRegisters.has(type))
            this.returnRegisters.set(type, new Register(type, true, "return"));

        return this.returnRegisters.get(type);
    }
    convert(exp, srcType, targetType) {
        // the only runtime consequences of type conversions are fixed-to-int conversions (and vice versa)
        if (targetType === PrimitiveType.FIXED && srcType.integral) {
            return Exp.of(
                Multiply, targetType,
                exp, this.fixedFactorExp
            );
        }

        if (targetType.integral && srcType === PrimitiveType.FIXED) {
            return Exp.of(
                Divide, targetType,
                exp, this.fixedFactorExp
            );
        }

        return exp;
    }
    conditional(condition, ifTrue, ifFalse) {
        const ifLabel = new Label();
        const elseLabel = new Label();
        const endLabel = new Label();
        return [
            ...this.jump.visit(condition, ifLabel, elseLabel),
            new LabelDecl(ifLabel),
            ...ifTrue,
            new Jump(endLabel),
            new LabelDecl(elseLabel),
            ...ifFalse,
            new LabelDecl(endLabel)
        ];
    }
    visit(node) {
        const exp = super.visit(node);

        if (
            AST.match(node, "Expression") &&
            node._targetType &&
            node._targetType !== node._type
        ) return this.convert(exp, node._type, node._targetType);

        return exp;
    }
    Continuing(stmt) {
        return this.visit(stmt.body);
    }
    While(loop) {
        return [
            new Jump(loop._labels.check),
            new LabelDecl(loop._labels.start),
            ...this.visit(loop.body),
            new LabelDecl(loop._labels.continuing),
            ...(loop.continuing ? this.visit(loop.continuing) : []),
            new LabelDecl(loop._labels.check),
            ...this.jump.visit(
                loop.condition,
                loop._labels.start,
                loop._labels.end
            ),
            new LabelDecl(loop._labels.end)
        ];
    }
    If(stmt) {
        return this.conditional(
            stmt.condition,
            this.visit(stmt.ifTrue),
            stmt.ifFalse ? this.visit(stmt.ifFalse) : []
        );
    }
    Break(stmt) {
        return [new Jump(stmt._loop._labels.end)];
    }
    Continue(stmt) {
        return [new Jump(stmt._loop._labels.continuing)]
    }
    Return(node) {
        const result = [new Return()];
        if (node.value) {
            const returnType = node.value._targetType;
            result.unshift(
                ...this.visit(node.value)
                    .copyInto(this.getReturnRegister(returnType))
            );
        }
        return result;
    }
    Reference({ _decl }) {
        if (_decl instanceof AST.Function)
            return new Exp(_decl._labels.entry);
        if (_decl instanceof AST.Param)
            return new Exp(this.getParamRegister(_decl._spec));
        return new Exp(_decl._reg);
    }
    Subscript(node) {
        return Exp.of(Load, node._type, this.addr.visit(node));
    }
    Dereference(node) {
        return Exp.of(Load, node._type, this.visit(node.target));
    }
    AddressOf(node) {
        return this.addr.visit(node.target);
    }
    Call(node) {
        // need to save variables
        const result = new Register(node._type, false, "call");
        return Exp.merge(
            (fn, ...args) => {
                return new Exp(
                    result,
                    [
                        // copy arguments into parameters
                        ...args.map((arg, i) => {
                            const paramType = node.fn._type.params[i];
                            const spec = new ParamSpec(i, paramType);
                            const reg = this.getParamRegister(spec);
                            return new Copy(args[i]).into(reg);
                        }),
                        // call function
                        new Call(fn),
                        // save return value (hopefully elided)
                        new Copy(this.getReturnRegister(node._type)).into(result)
                    ]
                );
            },
            this.visit(node.fn),
            ...node.args.map(arg => this.visit(arg))
        );
    }
    Ternary(node) {
        const result = new Register(node._type, false, "?");

        return new Exp(result, this.conditional(
            node.condition,
            this.visit(node.ifTrue).copyInto(result),
            this.visit(node.ifFalse).copyInto(result)
        ));
    }
    Array(array) {
        return Exp.merge(
            (...elements) => new Exp(new List(elements)),
            ...array.elements.map(el => this.visit(el))
        )
    }
    Product(product) {
        const left = this.visit(product.left);
        const right = this.visit(product.right);

        if (product._type === PrimitiveType.FIXED) {
            switch (product.op) {
                case "*": return Exp.of(
                    Divide, product._type,
                    Exp.of(
                        Multiply, product._type,
                        left, right
                    ),
                    this.fixedFactorExp
                );
            }
            product.error("NO FIXED POINT " + product.op);
        } else {
            switch (product.op) {
                case "*": return Exp.of(
                    Multiply, product._type,
                    left, right
                );
                case "%": return Exp.of(
                    Remainder, product._type,
                    left, right
                );
            }
            product.error("NO INTEGER " + product.op);
        }
    }
    Increment(inc) {
        const result = new Register(inc._type, false, inc.toString());
        const temp = new Register(inc._type, false, inc.op);
        const change = inc.op === "++" ? 1 : -1;
        return Exp.merge(
            target => new Exp(result, [
                new Load(target).into(result),
                new Add(result, new Constant(change)).into(temp),
                new Store(target, temp)
            ]),
            this.addr.visit(inc.target)
        )
    }
    Sum(sum) {
        return Exp.of(Add, sum._type, this.visit(sum.left), this.visit(sum.right));
    }
    Fixed(fixed) {
        return new Exp(new Constant(
            Math.round(+fixed.value * this.fixedFactor)
        ));
    }
    Int(int) {
        return new Exp(new Constant(+int.value));
    }
    Bool(bool) {
        return new Exp(new Constant(bool.value === "true" ? 1 : 0));
    }
    Negate(negate) {
        return Exp.of(Negate, negate._type, this.visit(negate.target));
    }
    Cast(cast) {
        return this.visit(cast.target);
    }
    Assign(assign) {
        const result = new Register(assign._type, false, "=");
        return Exp.merge(
            (right, left) => new Exp(result, [
                new Store(left, right),
                new Load(left).into(result)
            ]),
            this.visit(assign.right),
            this.addr.visit(assign.left),
        );
    }
    ExpressionStatement(stmt) {
        return this.visit(stmt.value).stmts;
    }
    Block(block) {
        return block.stmts.flatMap(stmt => this.visit(stmt));
    }
    Function(fn) {
        const body = [
            new LabelDecl(fn._labels.entry),
            ...this.visit(fn.body),
            new Return()
        ];
        return body;
    }
    Variable(variable) {
        return [];
    }
    root(root) {
        return [
            root._entry,
            ...root.decls.filter(fn => fn !== root._entry)
        ].map(decl => this.visit(decl));
    }
}

const assignRegisters = root => {
    root.forEach(AST.Variable, variable => {
        const global = !variable._scope._parent;
        variable._reg = new Register(variable._type, global, variable.name);
    });

    root.forEach(AST.Function, fn => {
        for (let i = 0; i < fn.params.length; i++) {
            const param = fn.params[i];
            param._spec = new ParamSpec(i, param._type);
        }
    });
};

const assignLabels = root => {
    root.forEach(AST.Function, fn => {
        fn._labels = {
            entry: new Label(true, fn.name)
        };
    });
    root.forEach(AST.While, loop => {
        loop._labels = {
            start: new Label(),
            continuing: new Label(),
            check: new Label(),
            end: new Label()
        };
    });
};

export default function toIR(root, config) {
    assignRegisters(root);
    assignLabels(root);

    return new IRGenerator(config).visit(root);
}