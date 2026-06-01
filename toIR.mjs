import { styleText } from "node:util";
import { AST } from "./ast.mjs";
import { ArrayType, PointerType, PrimitiveType } from "./types.mjs";
import Visitor from "/G:/My Drive/Desktop/Pipelang2/visitor.mjs";
import ValueMap from "/G:/My Drive/Desktop/Pipelang2/util/valueMap.mjs";
import { Add, Address, Call, Copy, Constant, Jump, Label, Load, Multiply, Negate, Register, Return, Store, Divide, List, Remainder, CompareJump, LabelDecl, Push, Pop, Protect, RecCall } from "./ir.mjs";
import { breadth, reverseGraph } from "./dependency.mjs";

const { make } = AST;

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
        // IRGenerator always returns an uncontextualized register
        const { value } = this.ir.visit(node);
        return new Exp(new Address(value));
    }
    Dereference(node) {
        return this.ir.visit(node.target);
    }
    PropertyAccess(node) {
        const { schema } = node.obj._type;
        const field = schema.fields.get(node.field);

        const sum = new Register(new PointerType(node._type), false, `${schema.name}.${node.field}`);

        return Exp.merge(
            objAddr => new Exp(sum, [
                new Add(objAddr, new Constant(field.offset)).into(sum)
            ]),
            this.visit(node.obj)
        );
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
        let result;
        if (node.constructor.name in this) {
            result = super.visit(node);
        } else {
            result = this.handleExpression(node);
        }
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
            case "||": return [
                ...this.visit(logic.left, this.ifTrue, afterFirst),
                new LabelDecl(afterFirst),
                ...this.visit(logic.right, this.ifTrue, this.ifFalse)
            ];
        }

        logic.error(`MISSING LOGIC ` + logic.op);
    }
    Not(not) {
        return this.visit(not.target, this.ifFalse, this.ifTrue);
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
    handleExpression(node) {
        const ref = this.ir.visit(node);
        return [
            ...ref.stmts,
            new CompareJump(ref.value, ">", this.ifTrue),
            new Jump(this.ifFalse)
        ];
    }
}

// generates code for the value of an expression
class IRGenerator extends Visitor {
    static INLINE_THRESHOLD = 25;
    constructor(config) {
        super();
        this.fixedFactor = 10 ** config.fixedPrecision;
        this.fixedFactorExp = new Exp(new Constant(this.fixedFactor));
        this.index = 0;
        this.addr = new AddrGenerator(this);
        this.jump = new JumpGenerator(this);
        this.returnRegisters = new ValueMap();
        this.functions = [];
        this.loops = [];
        this.inlineReturnLabels = [];
    }
    getIndirectReturnRegister(type) {
        if (!this.returnRegisters.has(type))
            this.returnRegisters.set(type, new Register(type, true, "return"));
    
        return this.returnRegisters.get(type);
    }
    getReturnRegister(fn) {
        if (fn._indirect)
            return this.getIndirectReturnRegister(fn._type.result);

        return fn._returnReg;
    }
    checkInline(fn) {
        if (!fn._inline) {
            fn._inline = false;
            return false;
        }
        
        return true;
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
    getLoopLabels(loop) {
        return this.loops.findLast(ctx => ctx.loop === loop).labels;
    }
    While(loop) {
        const labels = {
            start: new Label(),
            continuing: new Label(),
            check: new Label(),
            end: new Label()
        };
        this.loops.push({ loop, labels });
        const stmts = [
            new Jump(labels.check),
            new LabelDecl(labels.start),
            ...this.visit(loop.body),
            new LabelDecl(labels.continuing),
            ...(loop.continuing ? this.visit(loop.continuing) : []),
            new LabelDecl(labels.check),
            ...this.jump.visit(
                loop.condition,
                labels.start,
                labels.end
            ),
            new LabelDecl(labels.end)
        ];
        this.loops.pop();
        
        return stmts;
    }
    If(stmt) {
        return this.conditional(
            stmt.condition,
            this.visit(stmt.ifTrue),
            stmt.ifFalse ? this.visit(stmt.ifFalse) : []
        );
    }
    Break(stmt) {
        return [new Jump(this.getLoopLabels(stmt._loop).end)];
    }
    Continue(stmt) {
        return [new Jump(this.getLoopLabels(stmt._loop).continuing)]
    }
    Return(node) {
        const fn = this.functions.at(-1);
        
        const stmts = [];
        if (node.value) {
            const returnType = node.value._targetType;
            stmts.unshift(
                ...this.visit(node.value)
                    .copyInto(this.getReturnRegister(fn))
            );
        }

        if (fn._inline) {
            stmts.push(new Jump(this.inlineReturnLabels.at(-1)));
        } else {
            stmts.push(new Return());
        }
        return stmts;
    }
    Reference({ _decl }) {
        if (_decl instanceof AST.Function)
            return new Exp(_decl._labels.entry);
        if (_decl instanceof AST.Param)
            return new Exp(_decl._reg);
        return new Exp(_decl._reg);
    }
    PropertyAccess(node) {
        return Exp.of(Load, node._type, this.addr.visit(node));
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
        const caller = this.functions.at(-1);
        const result = new Register(node._type, false, "call");

        if (node._indirect || node.fn._decl._indirect) {
            node.error("Indirect calls are not supported");
        }

        // best case: call to direct function
        const fn = node.fn._decl;
        return Exp.merge(
            (label, ...args) => {
                const stmts = [];
                const saved = [];

                // copy arguments into parameters
                for (let i = 0; i < args.length; i++)
                    stmts.push(new Copy(args[i]).into(fn.params[i]._reg));

                if (this.checkInline(fn)) { // already visited and small
                    const returnLabel = new Label(false, `return_${fn.name}`);

                    // create inline call context
                    this.inlineReturnLabels.push(returnLabel);
                    this.functions.push(fn);
                    stmts.push(
                        ...this.visit(fn.body),
                        new LabelDecl(returnLabel)
                    );
                    this.functions.pop();
                    this.inlineReturnLabels.pop();
                } else if (fn._callable.has(caller)) {
                    stmts.push(new RecCall(label));
                } else {
                    stmts.push(new Call(label));
                }

                stmts.push(
                    // save return value (hopefully elided)
                    new Copy(this.getReturnRegister(fn)).into(result)
                );

                return new Exp(result, stmts);
            },
            this.visit(node.fn),
            ...node.args.map(arg => this.visit(arg))
        );
    }
    handleBoolean(expr) {
        const result = new Register(expr._type, false, "bool?");
        return new Exp(result, this.conditional(
            expr,
            [new Copy(new Constant(1)).into(result)],
            [new Copy(new Constant(0)).into(result)]
        ));
    }
    Compare(node) {
        return this.handleBoolean(node);
    }
    Logic(node) {
        return this.handleBoolean(node);
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
        );
    }
    Protect(node) {
        return Exp.of(Protect, node._type, this.visit(node.value));
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
                case "/": return Exp.of(
                    Divide, product._type,
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
        const scale = inc._type === PrimitiveType.FIXED ? this.fixedFactor : 1;
        const change = inc.op === "++" ? scale : -scale;
        return Exp.merge(
            target => new Exp(result, [
                new Load(target).into(result),
                new Add(result, new Constant(change)).into(temp),
                new Store(target, temp)
            ]),
            this.addr.visit(inc.target)
        );
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
        this.functions.push(fn);
        const bodyStmts = this.visit(fn.body);
        const small = bodyStmts.length <= IRGenerator.INLINE_THRESHOLD;
        fn._inline ??= (small || !!fn.inline) && !fn._recursive && !fn._indirect;
        
        // if this is only called in a intra-function context, its parameters/return are local
        if (this.checkInline(fn)) {
            console.log("INLINING " + fn.name);
            fn._returnReg.global = false;
            for (const param of fn.params)
                param._reg.global = false;
        }

        const stmts = [
            new LabelDecl(fn._labels.entry),
            ...bodyStmts,
            new Return()
        ];
        this.functions.pop();
        return stmts;
    }
    Variable(variable) {
        return [];
    }
    root(root) {
        // traverse call graph from leaves
        const leaves = new Set(root.decls.filter(decl => decl instanceof AST.Function))
            .difference(root._callGraph);
        const leafToRoot = new Set(breadth(leaves, reverseGraph(root._callGraph), true));
        leafToRoot.delete(root._entry);

        const fns = [];
        for (const fn of leafToRoot) {
            const code = this.visit(fn);
            if (!this.checkInline(fn)) fns.push(code);
        }
        fns.unshift(this.visit(root._entry));

        return fns;
    }
}

const assignRegisters = root => {
    root.forEach(AST.Variable, variable => {
        const global = !variable._scope._parent;
        variable._reg = new Register(variable._type, global, variable.name);
    });

    root.forEach(AST.Function, fn => {
        fn._returnReg = new Register(fn._type.result, true, `${fn.name}_ret`);
        for (let i = 0; i < fn.params.length; i++) {
            const param = fn.params[i];
            param._reg = new Register(param._type, true, `${fn.name}_${param.name}`);
        }
    });
};

const assignLabels = root => {
    root.forEach(AST.Function, fn => {
        fn._labels = {
            entry: new Label(true, fn.name)
        };
    });
};

export default function toIR(root, config) {
    assignRegisters(root);
    assignLabels(root);

    return new IRGenerator(config).visit(root);
}