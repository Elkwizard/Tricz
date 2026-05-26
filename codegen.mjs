import { findLinearBlocks } from "./cfg.mjs";
import { Add, Address, Binary, Branch, CompareJump, Constant, Copy, Label, LabelDecl, List, Load, Negate, Operand, Pop, Push, Register, StackOperation, Statement, Store, TAC, Unary } from "./ir.mjs";
import { ArrayType, PointerType, PrimitiveType } from "./types.mjs";
import * as zez from "./zez.mjs";
import { stripVTControlCharacters, styleText } from "node:util";
import exportGraph from "./dot.mjs";

class DependencyGraph {
    constructor() {
        this.nodeToDependencies = new Map();
        this.nodeToDependents = new Map();
    }
    getAllDependencies(node) {
        const found = new Set();

        let toExplore = new Set([node]);
        while (toExplore.size) {
            const toExploreNext = new Set();
            for (const node of toExplore) {
                if (!found.has(node)) {
                    found.add(node);

                    for (const dependency of this.getDependencies(node))
                        toExploreNext.add(dependency);
                }
            }
            toExplore = toExploreNext;
        }

        return found;
    }
    addDependency(dependent, dependency) {
        if (!this.nodeToDependencies.has(dependent))
            this.nodeToDependencies.set(dependent, new Set());
        this.nodeToDependencies.get(dependent).add(dependency);

        if (!this.nodeToDependents.has(dependency))
            this.nodeToDependents.set(dependency, new Set());
        this.nodeToDependents.get(dependency).add(dependent);
    }
    clear() {
        this.nodeToDependencies.clear();
        this.nodeToDependents.clear();
    }
    clearDependencies(node) {
        for (const dependency of this.getDependencies(node))
            this.nodeToDependents.get(dependency).delete(node);
        this.nodeToDependencies.delete(node);
    }
    clearDependents(node) {
        for (const dependent of this.getDependents(node))
            this.nodeToDependencies.get(dependent).delete(node);
        this.nodeToDependents.delete(node);
    }
    getDependents(node) {
        return this.nodeToDependents.get(node) ?? new Set();
    }
    getDependencies(node) {
        return this.nodeToDependencies.get(node) ?? new Set();
    }
}

class SymbolicExpression {
    /**
     * @type {Register[]}
     */
    get registers() {
        return [];
    }
    /**
     * @type {Address[]}
     */
    get addresses() {
        return [];
    }
}

class SymbolicOperand extends SymbolicExpression {
    /**
     * @param {Operand} operand 
     */
    constructor(operand) {
        super();
        this.operand = operand;
    }
    get registers() {
        return this.operand.registers;
    }
    get addresses() {
        return this.operand.addresses;
    }
    toString() {
        return `${this.operand}`;
    }
}

class SymbolicUnary extends SymbolicExpression {
    /**
     * @param {SymbolicExpression} target 
     */
    constructor(target) {
        super();
        this.target = target;
    }
    get registers() {
        return this.target.registers;
    }
    get addresses() {
        return this.target.addresses;
    }
}

class SymbolicNegate extends SymbolicUnary {
    toString() {
        return `Negate(${this.target})`;
    }
}

class SymbolicDeref extends SymbolicUnary {
    toString() {
        return `Deref(${this.target})`;
    }
}

class SymbolicOperator {
    /**
     * @param {any} type 
     * @param {SymbolicExpression[]} operands 
     */
    constructor(type, operands) {
        this.type = type;
        this.operands = operands;
    }
    get registers() {
        return this.operands.flatMap(op => op.registers);
    }
    toString() {
        return `${this.type.name}(${this.operands.join(", ")})`;
    }
}

class ZEZGenerator {
    constructor(stmts) {
        this.stmts = stmts;
    }
    compile() {
        this.locateSymbols();
        this.addBuiltinRegisters();
        this.protectIndirections();

        const blocks = findLinearBlocks(this.stmts);
        
        for (const block of blocks)
            console.log("\n\n" + block.join("\n"));

        // resolve all operands by collapsing multi-instruction sequences into efficient 0=2 expressions
        this.knownRegisters = new Map();
        this.possibleDeps = new DependencyGraph();
        this.definiteDeps = new DependencyGraph();
        this.resolutions = new Map();
        for (const block of blocks)
            this.resolveDependencies(block);

        // mark fundamentally needed registers so that writes don't go ignored
        this.markNecessary();

        // assign 0=2 addresses to remaining registers
        this.assignRegisterAddresses();

        console.log("=== MARKED NECESSARY ===");

        // generate code for each block, now that operands are resolved
        this.instructions = [];
        this.labelLines = new Map();
        this.lineNumber = 0;
        this.generateSetup();
        for (const block of blocks)
            for (const stmt of block)
                if (this.isStatementNecessary(stmt))
                    this.generateCode(stmt);

        this.substituteLabels();

        exportGraph(this.possibleDeps.nodeToDependencies, "dependency.dot");

        this.optimizeZEZ();

        return zez.stringify(this.instructions);
    }
    locateSymbols() {
        this.labels = new Set();
        this.registers = new Set();

        for (const stmt of this.stmts) {
            for (const register of stmt.registers)
                this.registers.add(register);

            if (stmt instanceof LabelDecl)
                this.labels.add(stmt.label);
        }
    }
    addBuiltinRegisters() {
        this.bufferSize = Math.max(1, ...[...this.registers].map(reg => reg.type.size));

        const BUILTIN_REGISTERS = {
            sp: new PointerType(PrimitiveType.VOID),
            src: new PointerType(PrimitiveType.VOID),
            dst: new PointerType(PrimitiveType.VOID),
            buffer: new ArrayType(PrimitiveType.INT, this.bufferSize)
        };

        this.builtinRegisters = {};
        for (const key in BUILTIN_REGISTERS) {
            const register = new Register(BUILTIN_REGISTERS[key], true, key);
            this.builtinRegisters[key] = register;
            this.registers.add(register);
        }
    }
    protectIndirections() {
        for (const stmt of this.stmts)
            for (const addr of stmt.addresses)
                addr.register.global = true;
    }
    assignRegisterAddresses() {
        let next = 1;
        this.addresses = new Map();
        for (const register of this.registers) {
            if (!register.global) continue;
            this.addresses.set(register, next);
            next += register.type.size;

            console.log(`${register} => ${this.addresses.get(register)}`);
        }

        this.builtin = {};
        for (const key in this.builtinRegisters)
            this.builtin[key] = zez.literal(
                this.addresses.get(this.builtinRegisters[key])
            );

        this.stackStart = next;
    }
    /**
     * @param {Statement} stmt 
     */
    isStatementNecessary(stmt) {
        if (stmt instanceof TAC)
            return stmt.writes
                .flatMap(write => write.registers)
                .some(reg => reg.global);

        return true;
    }
    markNecessary() {
        // all global registers are necessary
        for (const register of this.registers)
            if (register.global)
                this.possibleDeps.addDependency(null, register);

        // all registers which necessary registers depend on are necessary
        const necessaryRegisters = this.possibleDeps.getAllDependencies(null);
        necessaryRegisters.delete(null);
        for (const register of necessaryRegisters)
            register.global = true;
    }
    /**
     * @param {Operand} operand 
     */
    resolveOperand(operand, acceptOperator) {
        if (this.knownRegisters.has(operand)) {
            const expr = this.knownRegisters.get(operand);
            if (acceptOperator || !(expr instanceof SymbolicOperator))
                return expr;
        }

        return new SymbolicOperand(operand);
    }
    alterAll() {
        console.log("ALTER ALL");
        this.knownRegisters.clear();
        this.definiteDeps.clear();
    }
    alter(register) {
        const dependents = [...this.definiteDeps.getDependents(register)];
        console.log(`ALTER ${register}, DEPENDED ON BY [${dependents.join(", ")}]`);
        this.definiteDeps.clearDependents(register);
        this.knownRegisters.delete(register);
        for (const dependent of dependents)
            this.alter(dependent);
    }
    /**
     * @param {Statement[]} block 
     */
    resolveDependencies(block) {
        console.log("=== BEGIN ===");

        this.alterAll();

        for (const stmt of block) {
            console.log(stmt.toString());
            console.log(`KNOWN ${[...this.knownRegisters].map(([key, value]) => `${key} => ${value}`).join(", ")}`);

            const resolution = new Map();

            if (stmt instanceof Store) {
                // stores can allow more complex inputs
                const resolved = this.resolveOperand(stmt.src, true);
                resolution.set(stmt.src, resolved);
            }

            for (const read of stmt.reads) {
                // other instructions can only allow unary operators
                if (!resolution.has(read))
                    resolution.set(read, this.resolveOperand(read, false));

                const resolved = resolution.get(read);

                for (const register of resolved.registers) {
                    if (stmt instanceof TAC) {
                        this.definiteDeps.addDependency(stmt.dst, register);
                        this.possibleDeps.addDependency(stmt.dst, register);
                    } else {
                        this.possibleDeps.addDependency(null, register);
                    }
                }
            }

            this.resolutions.set(stmt, resolution);

            // update knowledge
            if (stmt instanceof TAC) {
                const { dst, src } = stmt;

                let expr;
                if (src instanceof Load) {
                    expr = new SymbolicDeref(
                        resolution.get(src.target)
                    );
                } else if (src instanceof Negate) {
                    expr = new SymbolicNegate(
                        resolution.get(src.target)
                    );
                } else if (src instanceof Copy) {
                    expr = resolution.get(src.target);
                } else if (src instanceof Unary) {
                    expr = new SymbolicOperator(
                        src.constructor,
                        [resolution.get(src.target)]
                    );
                } else if (src instanceof Binary) {
                    expr = new SymbolicOperator(
                        src.constructor, [
                            resolution.get(src.a),
                            resolution.get(src.b)
                        ]
                    );
                }

                this.alter(dst);
                if (expr && !expr.registers.includes(dst))
                    this.knownRegisters.set(dst, expr);
            } else if (stmt instanceof Store) {
                this.alterAll();
            } else if (stmt instanceof Pop) {
                this.alter(stmt.value);
                this.possibleDeps.addDependency(null, stmt.value);
            }
        }

        console.log("=== END ===\n\n");
    }
    emit(...instructions) {
        console.log(styleText("grey", `\tEMIT ${stripVTControlCharacters(instructions.join(" "))}`));
        for (const instruction of instructions) {
            this.instructions.push(instruction);
            if (instruction instanceof zez.Break)
                this.lineNumber++;
        }
    }
    generateSetup() {
        this.emit(
            ...zez.addLiteral(this.builtin.sp, zez.literal(this.stackStart))
        );
    }
    generateCode(stmt) {
        const resolution = this.resolutions.get(stmt);
        const operands = stmt.reads.map(op => resolution.get(op));

        console.log(`${stmt} {${operands.join(", ")}}`);

        if (stmt instanceof TAC) {
            this[stmt.src.constructor.name](
                stmt.dst.size,
                new SymbolicOperand(new Address(stmt.dst)),
                ...operands
            );
        } else if (stmt instanceof Store) {
            const addr = resolution.get(stmt.addr);
            let src = resolution.get(stmt.src);
            if (!(src instanceof SymbolicOperator))
                src = new SymbolicOperator(Copy, [src]);

            this[src.type.name](
                stmt.src.size, addr, ...src.operands
            );
        } else if (stmt instanceof Push) {
            this.Push(stmt.value.size, ...operands);
        } else if (stmt instanceof Pop) {
            this.Pop(
                stmt.value.size,
                new SymbolicOperand(new Address(stmt.value))
            );
        } else if (stmt instanceof Branch) {
            this[stmt.constructor.name](stmt, ...operands);
        } else if (stmt instanceof LabelDecl) {
            if (this.instructions.at(-1) instanceof zez.Instruction)
                this.emit(new zez.Break());
            this.labelLines.set(stmt.label, zez.literal(this.lineNumber - 1));
        }
    }
    /**
     * Generates the 0=2 AST to copy an n-register value from address `src` to address `dst`.
     * @param {number} size
     * @param {zez.Expression} src
     * @param {zez.Expression} dst
     * @returns {zez.Instruction[]}
     */
    copy(size, src, dst) {
        if (size === 1)
            return zez.setLiteral
    }
    /**
     * Generates the 0=2 AST for a given single-register symbolic expression
     * @param {SymbolicExpression} symExpr 
     */
    genExpr(symExpr) {
        if (symExpr instanceof SymbolicDeref)
            return zez.deref(this.genExpr(symExpr.target));

        if (symExpr instanceof SymbolicNegate)
            return zez.negate(this.genExpr(symExpr.target));

        if (
            symExpr instanceof SymbolicOperand &&
            symExpr.operand.size === 1
        ) {
            const { operand } = symExpr;

            if (operand instanceof Constant)
                return zez.literal(operand.value);

            if (operand instanceof Address)
                return zez.literal(this.addresses.get(operand.register));

            if (operand instanceof Register)
                return zez.deref(zez.literal(this.addresses.get(operand)));

            if (operand instanceof Label)
                return new zez.Placeholder(operand);
        }

        throw new Error(symExpr);
    }
    createMemoryWalker(start, kind) {
        if (start instanceof zez.Literal) {
            return {
                init: [],
                get: i => zez.literal(start.value + i),
                next: []
            };
        }

        return {
            init: [...zez.setLiteral(this.builtin[kind], start)],
            get: i => zez.deref(this.builtin[kind]),
            next: [...zez.addLiteral(this.builtin[kind], zez.literal(1))]
        };
    }
    /**
     * Generates the 0=2 AST to copy a given series of 1-register symbolic expressions into a destination address
     * @param {zez.Expression} exprs 
     * @param {zez.Expression} destination 
     * @param {boolean} noAlias 
     * @returns {zez.Instruction[]}
     */
    copyExprs(exprs, destination, noAlias) {
        if (!exprs.length)
            return [];
        
        // directly copy values
        if (exprs.length === 1)
            return this.safeSetLiteral(destination, exprs[0]);

        // copy to intermediate buffer
        if (!noAlias)
            return [
                ...this.copyExprs(exprs, this.builtin.buffer, true),
                ...this.copyMemory(exprs.length, this.builtin.buffer, destination, true)
            ];

        const dstWalker = this.createMemoryWalker(destination, "dst");
        const stmts = [...dstWalker.init];
        for (let i = 0; i < exprs.length; i++) {
            stmts.push(...zez.setLiteral(dstWalker.get(i), exprs[i]));
            if (i < exprs.length - 1)
                stmts.push(...dstWalker.next);
        }

        return stmts;
    }
    /**
     * Generates the 0=2 AST to copy a given symbolic expression into a destination address
     * @param {SymbolicExpression} symExpr 
     * @param {zez.Expression} dst 
     * @param {boolean} noAlias
     */
    copyExpr(symExpr, dst, noAlias = false) {
        noAlias ||= symExpr.registers.length - symExpr.addresses.length === 0;

        // copy list
        const getElements = sym => {
            if (sym instanceof SymbolicOperand) {
                const { operand } = sym;

                if (operand instanceof List) {
                    return operand.elements.flatMap(
                        el => getElements(new SymbolicOperand(el))
                    );
                }
                
                if (operand instanceof Register) {
                    const addr = this.addresses.get(operand);
                    return [...new Array(operand.size).keys()]
                        .map(i => zez.deref(zez.literal(addr + i)));
                }
            }

            return [this.genExpr(sym)];
        }

        return this.copyExprs(getElements(symExpr), dst, noAlias);
    }
    /**
     * Returns the 0=2 AST to copy a size-register block of memory from address src to dst.
     * @param {number} size 
     * @param {zez.Expression} src 
     * @param {zez.Expression} dst 
     * @param {boolean} noAlias
     */
    copyMemory(size, src, dst, noAlias = false) {
        if (size > this.bufferSize)
            throw new Error(`${size} > ${this.bufferSize}`);

        if (size === 1)
            return this.safeSetLiteral(dst, zez.deref(src), noAlias);
        
        noAlias ||= !this.mightAlias(size, src, dst);

        if (!noAlias) {
            // copy to intermediate buffer
            return [
                ...this.copyMemory(size, src, this.builtin.buffer, true),
                ...this.copyMemory(size, this.builtin.buffer, dst, true)
            ];
        }
        
        // perform copy directly
        const dstWalker = this.createMemoryWalker(dst, "dst");
        const srcWalker = this.createMemoryWalker(src, "src");
        
        const stmts = [...dstWalker.init, ...srcWalker.init];

        for (let i = 0; i < size; i++) {
            stmts.push(
                ...zez.set(dstWalker.get(i), srcWalker.get(i))
            );
            if (i < size - 1)
                stmts.push(...srcWalker.next, ...dstWalker.next);
        }

        return stmts;
    }
    getLiteralValue(expr) {
        if (expr instanceof zez.Negate)
            return -expr.target.value;
        return expr.value;
    }
    getIndirectionAddress(expr) {
        if (expr instanceof zez.Negate)
            expr = expr.target;

        return expr instanceof zez.Deref || expr instanceof zez.Sign ? expr.target : null;
    }
    mightAlias(size, src, dst) {
        if (this.getIndirectionAddress(src) || this.getIndirectionAddress(dst))
            return true;

        src = this.getLiteralValue(src);
        dst = this.getLiteralValue(dst);

        return dst <= src && src < dst + size;
    }
    /**
     * Returns true if two given Deref expressions might be dereferencing the same memory
     * @param {zez.Expression} a 
     * @param {zez.Expression} b 
     * @returns {boolean}
     */
    mightAliasValues(a, b) {
        a = this.getIndirectionAddress(a);
        b = this.getIndirectionAddress(b);

        if (!a || !b) return false;

        return this.mightAlias(1, a, b);
    }
    safeSetLiteral(dst, src, noAlias = false) {
        noAlias ||= !this.mightAliasValues(zez.deref(src), dst);
        
        if (!noAlias)
            return [
                ...zez.setLiteral(this.builtin.buffer, src),
                ...zez.set(dst, this.builtin.buffer)
            ];
        
        return zez.setLiteral(dst, src);

    }
    Push(size, value) {
        this.emit(
            ...this.copyExpr(
                value, zez.deref(this.builtin.sp), true
            ),
            ...zez.addLiteral(this.builtin.sp, zez.literal(size))
        );
    }
    Pop(size, dst) {
        this.emit(
            ...zez.addLiteral(this.builtin.sp, zez.literal(-size)),
            ...this.copyMemory(
                size, zez.deref(this.builtin.sp), this.genExpr(dst), true
            )
        );
    }
    Copy(size, dst, src) {
        this.emit(
            ...this.copyExpr(src, this.genExpr(dst))
        );
    }
    Load(size, dst, addr) {
        this.emit(
            ...this.copyMemory(
                size, this.genExpr(addr), this.genExpr(dst)
            )
        );
    }
    Negate(size, dst, src) {
        this.emit(
            ...this.safeSetLiteral(
                this.genExpr(dst),
                zez.negate(this.genExpr(src))
            )
        );
    }
    Add(size, dst, a, b) {
        dst = this.genExpr(dst);
        a = this.genExpr(a);
        b = this.genExpr(b);

        const dstValue = zez.deref(dst);

        if (dstValue.equals(a)) {
            this.emit(
                ...zez.addLiteral(dst, b)
            );
        } else if (dstValue.equals(b)) {
            this.emit(
                ...zez.addLiteral(dst, a)
            );
        } else if (this.mightAliasValues(dstValue, a) || this.mightAliasValues(dstValue, b)) {
            this.emit(
                ...zez.setLiteral(this.builtin.buffer, a),
                ...zez.addLiteral(this.builtin.buffer, b),
                ...zez.setLiteral(dst, zez.deref(this.builtin.buffer))
            );
        } else {
            this.emit(
                ...zez.setLiteral(dst, a),
                ...zez.addLiteral(dst, b)
            );
        }
    }
    CompareJump(stmt, value, label) {
        let { compare } = stmt;

        value = this.genExpr(value);
        label = this.genExpr(label);

        // optimally create sign expression for "value", factoring out -
        let flipSign = false;

        if (value instanceof zez.Negate) {
            value = value.target;
            flipSign = !flipSign;
        }

        let sign;

        if (value instanceof zez.Sign) {
            sign = value;
        } else if (value instanceof zez.Literal) {
            sign = zez.literal(Math.sign(value.value));
        } else if (value instanceof zez.Deref) {
            sign = zez.sign(value.target);
        } else {
            throw new Error(value); // not possible
        }

        if (compare === ">" || compare === ">=")
            flipSign = !flipSign;

        if (flipSign) sign = zez.negate(sign);

        this.emit(
            ...zez.addLiteral(zez.ZERO, sign),
            ...zez.addLiteral(zez.ZERO, zez.literal(1)),
            new zez.Break()
        );

        const jump = zez.setLiteral(zez.ZERO, label);
        const nop = zez.addLiteral(zez.ZERO, zez.literal(0));
        const skip = zez.addLiteral(zez.ZERO, zez.literal(1));

        switch (stmt.compare) {
            case ">":
            case "<": {
                this.emit(
                    ...jump, new zez.Break(),
                    ...nop, new zez.Break()
                );
            }; break;
            case ">=":
            case "<=": {
                this.emit(
                    ...jump, new zez.Break(),
                    ...jump, new zez.Break()
                );
            }; break;
            case "==": {
                this.emit(
                    ...skip, new zez.Break(),
                    ...jump, new zez.Break()
                );
            }; break;
            case "!=": {
                this.emit(
                    ...jump, new zez.Break(),
                    ...skip, new zez.Break(),
                    ...jump, new zez.Break()
                );
            }; break;
        }
    }
    Jump(stmt, label) {
        this.emit(
            ...zez.setLiteral(zez.ZERO, this.genExpr(label)),
            new zez.Break()
        );
    }
    Call(stmt, fn) {
        this.emit(
            ...zez.set(zez.deref(this.builtin.sp), zez.ZERO),
            ...zez.addLiteral(this.builtin.sp, zez.literal(1)),
            ...zez.setLiteral(zez.ZERO, this.genExpr(fn)),
            new zez.Break()
        );
    }
    Return(stmt) {
        this.emit(
            ...zez.addLiteral(this.builtin.sp, zez.literal(-1)),
            ...zez.set(zez.ZERO, zez.deref(this.builtin.sp)),
            new zez.Break()
        );
    }
    substituteLabels() {
        for (const instruction of this.instructions)
            instruction.replace(this.labelLines);
    }
    optimizeZEZ() {

    }
}

export default function codegen(fns) {
    // const reg = new Register(PrimitiveType.INT, true);
    // const reg2 = new Register(PrimitiveType.INT, true);
    // const label = new Label();
    // const arrReg = new Register(new ArrayType(new ArrayType(PrimitiveType.INT, 2), 2));
    const generator = new ZEZGenerator([
        new Push(new Constant(-2)),
        // new Negate(new Constant(1)).into(reg),
        // new Negate(reg).into(reg),
        // new LabelDecl(label),
        // new Negate(reg).into(reg2),
        // new CompareJump(reg, "<", label),
        // new Push(new List([
        //     new List([new Constant(3), new Constant(-1)]),
        //     new List([new Constant(2), reg2])
        // ])),
        // new Pop(arrReg),
        ...fns.flat()
    ]);

    return generator.compile();
}