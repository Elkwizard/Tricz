import fs from "node:fs";
import { findLinearBlocks } from "./cfg.mjs";
import { Add, Address, Binary, Branch, Constant, Copy, Label, LabelDecl, Load, Negate, Operand, Pop, Push, Register, StackOperation, Statement, Store, TAC, Unary } from "./ir.mjs";
import { PointerType, PrimitiveType } from "./types.mjs";
import * as zez from "./zez.mjs";
import { stripVTControlCharacters, styleText } from "node:util";

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
    toString() {
        let result = "digraph {\n";
        for (const [node, dependencies] of this.nodeToDependencies) {
            for (const dependency of dependencies) {
                result += `"${node}" -> "${dependency}"\n`;
            }
        }
        result += "\n}";
        return stripVTControlCharacters(result);
    }
}

class SymbolicExpression {
    /**
     * @type {Register[]}
     */
    get registers() {
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
    toString() {
        return `${this.operand}`;
    }
}

class SymbolicNegate extends SymbolicExpression {
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
    toString() {
        return `Negate(${this.target})`;
    }
}

class SymbolicDeref extends SymbolicExpression {
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
    toString() {
        return `Deref(${this.target})`;
    }
}

class SymbolicOperator extends SymbolicExpression {
    /**
     * @param {any} type 
     * @param {SymbolicExpression[]} operands 
     */
    constructor(type, operands) {
        super();
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
    static BUILTIN_REGISTERS = {
        sp: new PointerType(PrimitiveType.VOID)
    };
    constructor(stmts) {
        this.stmts = stmts;
    }
    compile() {
        const { BUILTIN_REGISTERS } = ZEZGenerator;

        this.locateSymbols();
        this.builtinRegisters = { };
        for (const key in BUILTIN_REGISTERS) {
            const register = new Register(BUILTIN_REGISTERS[key], true);
            this.builtinRegisters[key] = register;
            this.registers.add(register);
        }
        this.protectIndirections();

        const blocks = findLinearBlocks(this.stmts);

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
        this.nextRegister = 1;
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

        fs.writeFileSync("dependency.dot", this.possibleDeps.toString(), "utf-8");
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
    protectIndirections() {
        for (const stmt of this.stmts)
            for (const addr of stmt.addresses)
                addr.register.global = true;
    }
    assignRegisterAddresses() {
        this.addresses = new Map();
        for (const register of this.registers) {
            if (!register.global) continue;
            this.addresses.set(register, this.nextRegister);
            this.nextRegister += register.type.size;
        }

        this.builtin = { };
        for (const key in this.builtinRegisters)
            this.builtin[key] = new zez.Literal(
                this.addresses.get(this.builtinRegisters[key])
            );
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

            // stores can allow more complex inputs
            if (stmt instanceof Store) {
                const resolved = this.resolveOperand(stmt.src, true);
                resolution.set(stmt.src, resolved);
            }

            // other instructions can only allow unary operators
            for (const read of stmt.reads) {
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
            }
        }
        
        console.log("=== END ===\n\n");
    }
    emit(...instructions) {
        console.log(`${styleText("yellow", "EMIT")} ${instructions.join(" ")}`);
        for (const instruction of instructions) {
            this.instructions.push(instruction);
            if (instruction instanceof zez.Break)
                this.lineNumber++;
        }
    }
    generateSetup() {
        this.emit(zez.addLiteral(this.builtin.sp, this.nextRegister));
    }
    generateCode(stmt) {
        const resolution = this.resolutions.get(stmt);
        const operands = stmt.reads.map(op => resolution.get(op));
        
        console.log(`${stmt} [${operands.join(", ")}]`);

        const genExprs = symExprs => symExprs.map(symExpr => this.genExpr(symExpr));

        if (stmt instanceof TAC) {
            this[stmt.src.constructor.name](
                this.genExpr(new SymbolicOperand(stmt.dst)),
                ...genExprs(operands)
            );
        } else if (stmt instanceof Store) {
            const addr = resolution.get(stmt.addr);
            let src = resolution.get(stmt.src);
            if (!(src instanceof SymbolicOperator))
                src = new SymbolicOperator(Copy, [src]);

            this[src.type.name](
                this.genExpr(new SymbolicDeref(addr)),
                ...genExprs(src.operands)
            );
        } else if (stmt instanceof StackOperation) {
            this[stmt.constructor.name](...genExprs(operands));
        } else if (stmt instanceof Branch) {
            this[stmt.constructor.name](stmt, ...genExprs(operands));
        } else if (stmt instanceof LabelDecl) {
            if (this.instructions.at(-1) instanceof zez.Instruction)
                this.emit(new zez.Break());
            this.labelLines.set(stmt.label, this.lineNumber);
        }
    }
    /**
     * Generates the 0=2 AST for a given symbolic expression
     * @param {SymbolicExpression} symExpr 
     */
    genExpr(symExpr) {
        if (symExpr instanceof SymbolicDeref)
            return new zez.Deref(this.genExpr(symExpr.target));
        
        if (symExpr instanceof SymbolicNegate)
            return new zez.Negate(this.genExpr(symExpr.target));

        if (symExpr instanceof SymbolicOperand) {
            const { operand } = symExpr;

            if (operand instanceof Constant)
                return new zez.Literal(operand.value);
            
            if (operand instanceof Address)
                return new zez.Literal(this.addresses.get(operand.register));

            if (operand instanceof Register)
                return new zez.Deref(new zez.Literal(this.addresses.get(operand)));
        }

        throw symExpr;
    }
    Push(value) {
        this.emit(
            ...zez.setLiteral(
                new zez.Deref(this.builtin.sp),
                value
            ),
            ...zez.addLiteral(this.builtin.sp, 1)
        );
    }
}

export default function codegen(fns) {
    const generator = new ZEZGenerator([
        new Push(new Constant(-1)),
        ...fns.flat()
    ]);

    return generator.compile();
}