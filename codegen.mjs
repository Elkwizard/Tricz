import { findLinearBlocks } from "./cfg.mjs";
import { Add, Address, Binary, Branch, CompareJump, Constant, Copy, Label, LabelDecl, List, Load, Negate, Operand, Pop, Push, Register, StackOperation, Statement, Store, TAC, Unary } from "./ir.mjs";
import { ArrayType, PointerType, PrimitiveType } from "./types.mjs";
import * as zez from "./zez.mjs";
import { stripVTControlCharacters, styleText } from "node:util";
import exportGraph from "./dot.mjs";
import { DependencyGraph } from "./dependency.mjs";
import { IRStateTracker, SymbolicExpression, SymbolicOperand, SymbolicOperator } from "./IRStateTracker.mjs";
import { findAddressed } from "./analyze.mjs";

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

class SymbolicSum extends SymbolicExpression {
    /**
     * @param {SymbolicExpression} a
     * @param {SymbolicExpression} b
     */
    constructor(a, b) {
        super();
        this.a = a;
        this.b = b;
    }
    get registers() {
        return [...this.a.registers, ...this.b.registers];
    }
    get addresses() {
        return [...this.a.addresses, ...this.b.addresses];
    }
}

class ZEZGenerator {
    constructor(stmts) {
        this.stmts = stmts;
    }
    compile() {
        this.locateSymbols();
        this.addBuiltinRegisters();
        this.addressed = findAddressed(this.stmts);
        this.protectIndirections();

        const blocks = findLinearBlocks(this.stmts);

        // resolve all operands by collapsing multi-instruction sequences into efficient 0=2 expressions
        this.stateTracker = new IRStateTracker(this.addressed);
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
        this.lineNumberSymbol = "ZERO";
        this.generateSetup();
        for (const block of blocks)
            for (const stmt of block)
                if (this.isStatementNecessary(stmt))
                    this.generateCode(stmt);

        this.substituteLabels();

        exportGraph(this.stateTracker.possibleDeps.nodeToDependencies, "dependency.dot");

        return this.instructions;
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
            math: PrimitiveType.INT,
            mathA: PrimitiveType.INT,
            mathB: PrimitiveType.INT,
            mathIndex: PrimitiveType.INT,
            mathTempSign: PrimitiveType.INT,
            mathSign: PrimitiveType.INT,
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
        for (const register of this.addressed)
            register.global = true;
    }
    assignRegisterAddresses() {
        let next = 1;
        this.indirectAddrs = new Set();
        this.addresses = new Map();
        for (const register of this.registers) {
            if (!register.global) continue;
            this.addresses.set(register, next);
            
            for (let i = 0; i < register.type.size; i++) {
                const addr = next++;
                if (this.addressed.has(register))
                    this.indirectAddrs.add(addr);
            }

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
                this.stateTracker.addNecessary(register);

        // all registers which necessary registers depend on are necessary
        const necessaryRegisters = this.stateTracker.getNecessaryRegisters();
        necessaryRegisters.delete(null);
        for (const register of necessaryRegisters)
            register.global = true;
    }
    emit(...instructions) {
        console.log(styleText("grey", `\tEMIT ${stripVTControlCharacters(instructions.join(" "))}`));
        for (const instruction of instructions) {
            this.instructions.push(instruction);
        }
    }
    isEventualConstant(expr) {
        if (!(expr instanceof SymbolicOperand))
            return false;

        const { operand } = expr;
        return operand instanceof Address || operand instanceof Constant;
    }
    createSpecializedExpression(src, resolution) {
        if (src instanceof Copy)
            return resolution.get(src.target);
        
        if (src instanceof Load)
            return new SymbolicDeref(
                resolution.get(src.target)
            );
        
        if (src instanceof Negate)
            return new SymbolicNegate(
                resolution.get(src.target)
            );
        
        if (src instanceof Add) {
            const a = resolution.get(src.a);
            const b = resolution.get(src.b);

            if (this.isEventualConstant(a) && this.isEventualConstant(b)) {
                // TODO: make this an optimized case, even though it doesn't happen
            }
        }

    
        return null;
    }
    /**
     * @param {Statement[]} block 
     */
    resolveDependencies(block) {
        this.stateTracker.alterAll();
        
        for (const stmt of block) {
            const wideReads = new Set();
            if (stmt instanceof Store) wideReads.add(stmt.src);
            const resolution = this.stateTracker.resolveStatement(stmt, wideReads);

            this.stateTracker.handleStatement(
                stmt, resolution, this.createSpecializedExpression.bind(this)
            );

            this.resolutions.set(stmt, resolution);
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
            this.emit(stmt.label);
        }
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

            // must be 1 size, per precondition
            if (operand instanceof List)
                return this.genExpr(new SymbolicOperand(operand.elements[0]));
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
            next: [...zez.addLiteral(this.builtin[kind], zez.ONE)]
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
        if (exprs.length === 1) {
            return this.safeSetLiteral(destination, exprs[0]);
        }

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
    isDirect(addr) {
        return addr instanceof zez.Literal && !this.indirectAddrs.has(addr.value);
    }
    mightAlias(size, src, dst) {
        if (!this.getIndirectionAddress(src) && !this.getIndirectionAddress(dst)) {
            src = this.getLiteralValue(src);
            dst = this.getLiteralValue(dst);
    
            return src < dst || src >= dst + size;
        }

        if (this.isDirect(src) || this.isDirect(dst))
            return false;
            
        return true;
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
        if (zez.deref(dst).equals(src))
            return zez.addLiteral(dst, zez.ZERO);

        noAlias ||= !this.mightAliasValues(zez.deref(dst), src);

        if (!noAlias)
            return [
                ...zez.setLiteral(this.builtin.buffer, src),
                ...zez.set(dst, this.builtin.buffer)
            ];

        return zez.setLiteral(dst, src);

    }
    setZeroLiteral(value) {
        return [
            ...zez.addLiteral(zez.ZERO, zez.negate(new zez.Placeholder(this.lineNumberSymbol))),
            ...zez.addLiteral(zez.ZERO, value)
        ];
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
    // Multiply(size, dst, a, b) {
    //     dst = this.genExpr(dst);
    //     a = this.genExpr(a);
    //     b = this.genExpr(b);
    // }
    computeSign(value) {
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

        return flipSign ? zez.negate(sign) : sign;
    }
    fixSign(dst, expr) {
        const { mathSign } = this.builtin;

        return [
            ...zez.setLiteral(dst, expr),
            ...zez.addLiteral(zez.ZERO, zez.sign(dst)),
            zez.SKIP,
            new zez.Break(),
            // if expr < 0
            ...zez.addLiteral(mathSign, zez.ONE),
            ...zez.setLiteral(dst, zez.negate(expr)),
            new zez.Break(),
            // if expr = 0
            zez.NOOP,
            new zez.Break()
        ];
    }
    divmod(remainder, dst, a, b) {
        dst = this.genExpr(dst);
        a = this.genExpr(a);
        b = this.genExpr(b);

        const { math, mathA, mathB, mathIndex, mathTempSign, mathSign } = this.builtin;

        this.emit(
            ...zez.setLiteral(mathIndex, zez.ZERO),
            ...zez.setLiteral(mathSign, zez.ZERO)
        );

        // determine sign
        if (remainder) {
            // mathSign = (a < 0)
            this.emit(
                ...this.fixSign(math, a),
                ...zez.setLiteral(mathB, b)
            );
        } else {
            // mathSign = (a < 0) + (b < 0)
            this.emit(
                ...this.fixSign(math, a),
                ...this.fixSign(mathB, b)
            );
        }

        // main loop
        this.emit(
            new zez.Break(),
            ...zez.set(mathTempSign, math),
            ...zez.subtract(mathTempSign, mathB),
            ...zez.addLiteral(zez.ZERO, zez.sign(mathTempSign)),
            zez.SKIP,
            new zez.Break(),
            // if math < mathB
            ...zez.addLiteral(zez.ZERO, zez.literal(2)),
            new zez.Break(),
            // if math = mathB
            zez.NOOP,
            new zez.Break(),
            // if math > mathB
            ...zez.subtract(math, mathB),
            ...zez.addLiteral(mathIndex, zez.ONE),
            ...zez.subtractLiteral(zez.ZERO, zez.literal(4)),
            new zez.Break(),
        );

        // apply sign
        if (remainder) {
            this.emit(
                ...zez.add(zez.ZERO, mathSign),
                new zez.Break(),
                // if a >= 0
                ...zez.set(dst, math),
                zez.SKIP,
                new zez.Break(),
                // if a < 0
                ...zez.setLiteral(dst, zez.negate(zez.deref(math))),
                new zez.Break()
            );
        } else {
            this.emit(
                ...zez.add(zez.ZERO, mathSign),
                new zez.Break(),
                // if a >= 0 && b >= 0
                zez.SKIP,
                new zez.Break(),
                // if (a < 0) != (b < 0)
                ...zez.setLiteral(dst, zez.negate(zez.deref(mathIndex))),
                zez.SKIP,
                new zez.Break(),
                // if a < 0 && b < 0
                ...zez.set(dst, mathIndex),
                new zez.Break()
            );
        }
    }
    Divide(size, dst, a, b) {
        this.divmod(false, dst, a, b);
    }
    Remainder(size, dst, a, b) {
        this.divmod(true, dst, a, b);
    }
    CompareJump(stmt, value, label) {
        let { compare } = stmt;

        value = this.genExpr(value);
        label = this.genExpr(label);

        let sign = this.computeSign(value);
        if (compare === ">" || compare === ">=")
            sign = zez.negate(sign);

        this.emit(
            ...zez.addLiteral(zez.ZERO, sign),
            zez.SKIP,
            new zez.Break()
        );

        const jump = () => this.setZeroLiteral(label);

        switch (stmt.compare) {
            case ">":
            case "<": {
                this.emit(...jump(), new zez.Break());
                this.emit(zez.NOOP, new zez.Break());
            }; break;
            case ">=":
            case "<=": {
                this.emit(...jump(), new zez.Break());
                this.emit(...jump(), new zez.Break());
            }; break;
            case "==": {
                this.emit(zez.SKIP, new zez.Break(),);
                this.emit(...jump(), new zez.Break());
            }; break;
            case "!=": {
                this.emit(...jump(), new zez.Break());
                this.emit(zez.SKIP, new zez.Break());
                this.emit(...jump(), new zez.Break());
            }; break;
        }
    }
    Jump(stmt, label) {
        this.emit(
            ...this.setZeroLiteral(this.genExpr(label)),
            new zez.Break()
        );
    }
    Call(stmt, fn) {
        this.emit(
            ...zez.setLiteral(
                zez.deref(this.builtin.sp),
                zez.literal(new zez.Placeholder(this.lineNumberSymbol))
            ),
            ...zez.addLiteral(this.builtin.sp, zez.ONE),
            ...this.setZeroLiteral(this.genExpr(fn)),
            new zez.Break()
        );
    }
    Return(stmt) {
        this.emit(
            ...zez.addLiteral(this.builtin.sp, zez.literal(-1)),
            ...this.setZeroLiteral(zez.deref(zez.deref(this.builtin.sp))),
            new zez.Break()
        );
    }
    substituteLabels() {
        const instructions = [];
        const substitutions = new Map();
        let lineNumber = 0;
        for (const instruction of this.instructions) {
            if (instruction instanceof Label) {
                substitutions.set(instruction, zez.literal(lineNumber - 1));
            } else {
                instructions.push(instruction);
                if (instruction instanceof zez.Break)
                    lineNumber++;
            }
        }

        lineNumber = 0;
        for (const instruction of instructions) {
            substitutions.set(this.lineNumberSymbol, zez.literal(lineNumber));
            instruction.replace(substitutions);
            if (instruction instanceof zez.Break)
                lineNumber++;
        }

        this.instructions = instructions;
    }
}

export default function codegen(fns) {
    const generator = new ZEZGenerator([
        new Push(new Constant(-2)),
        ...fns.flat()
    ]);

    return generator.compile();
}