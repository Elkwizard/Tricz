import config from "./config.mjs";
import { DependencyGraph } from "./dependency.mjs";
import { Binary, Branch, Call, Copy, LabelDecl, Load, Negate, Operand, Pop, Protect, RecCall, Store, TAC, Unary } from "./ir.mjs";

export class IRStateTracker {
    /**
     * @param {Set<Register>} addressed 
     */
    constructor(addressed) {
        this.definiteDeps = new DependencyGraph();
        this.possibleDeps = new DependencyGraph();
        this.knownRegisters = new Map();
        this.addressed = addressed;
        this.loadRegisters = new Set();
    }
    get hasLogging() {
        return config.log?.stateTracking;
    }
    addNecessary(register) {
        this.possibleDeps.addDependency(null, register);
    }
    getNecessaryRegisters() {
        return this.possibleDeps.getAllDependencies(null);
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
        if (this.hasLogging)
            console.log("  ALTER ALL");
        this.knownRegisters.clear();
        this.definiteDeps.clear();
        this.loadRegisters.clear();
    }
    alter(register) {
        const dependents = [...this.definiteDeps.getDependents(register)];
        if (this.hasLogging)
            console.log(`  ALTER ${register}, DEPENDED ON BY [${dependents.join(", ")}]`);
        this.definiteDeps.delete(register);
        this.knownRegisters.delete(register);
        this.loadRegisters.delete(register);
        if (this.addressed.has(register))
            dependents.push(...this.loadRegisters);
        for (const dependent of dependents)
            this.alter(dependent);
    }
    /**
     * @param {Statement} stmt
     * @param {Set<Operand>} wideReads
     */
    resolveStatement(stmt, wideReads = new Set()) {
        if (this.hasLogging) {
            console.log("\n" + stmt.toString());
            console.log(`  KNOWN ${[...this.knownRegisters].map(([key, value]) => `${key} => ${value}`).join(", ")}`);
            console.log(`  DEFINITE DEPENDENCIES\n${this.definiteDeps}`);
        }

        const resolution = new Map();

        // some instruction slots can allow full binary operators
        for (const read of wideReads)
            resolution.set(read, this.resolveOperand(read, true));

        for (const read of stmt.reads) {
            // most instructions can only allow unary operators
            if (!resolution.has(read))
                resolution.set(read, this.resolveOperand(read, false));

            const resolved = resolution.get(read);
        }

        return resolution;
    }
    /**
     * @param {Statement} stmt
     * @param {(src: Unary | Binary, resolution: Map<Operand, SymbolicExpression | SymbolicOperator>, dst: Register) => SymbolicExpression | null} createSpecializedExpression
     */
    handleStatement(stmt, resolution, createSpecializedExpression = () => null) {
        const newDependencies = [];

        for (const { registers } of resolution.values()) {
            for (const register of registers) {
                if (stmt instanceof TAC) {
                    newDependencies.push(register);
                    this.possibleDeps.addDependency(stmt.dst, register);
                } else {
                    this.possibleDeps.addDependency(null, register);
                }
            }
        }

        // update knowledge
        if (stmt instanceof TAC) {
            const { dst, src } = stmt;

            let expr = createSpecializedExpression(src, resolution, dst);
            if (!expr) {
                if (src instanceof Unary) {
                    expr = new SymbolicOperator(
                        src.constructor,
                        [resolution.get(src.target)]
                    );
                } else if (src instanceof Binary) {
                    expr = new SymbolicOperator(
                        src.constructor,
                        [
                            resolution.get(src.a),
                            resolution.get(src.b)
                        ]
                    );
                }
            }

            this.alter(dst);
            
            if (src instanceof Load) {
                this.loadRegisters.add(dst);
            } else if (src instanceof Protect) {
                expr = null;
            }

            if (expr && !expr.registers.includes(dst)) {
                // add new knowledge after change
                for (const dep of newDependencies)
                    this.definiteDeps.addDependency(dst, dep);

                this.knownRegisters.set(dst, expr);
            }
        } else if (stmt instanceof Call || stmt instanceof RecCall) {
            for (const reg of [...this.knownRegisters.keys()])
                if (reg.global || this.addressed.has(reg))
                    this.alter(reg);
        } else if (stmt instanceof Store || stmt instanceof Branch || stmt instanceof LabelDecl) {
            this.alterAll();
        } else if (stmt instanceof Pop) {
            this.alter(stmt.value);
            this.possibleDeps.addDependency(null, stmt.value);
        }
    }
}

export class SymbolicOperator {
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
export class SymbolicExpression {
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

export class SymbolicOperand extends SymbolicExpression {
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