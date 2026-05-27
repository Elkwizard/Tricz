import { DependencyGraph } from "./dependency.mjs";
import { Binary, Copy, Load, Negate, Operand, Pop, Store, TAC, Unary } from "./ir.mjs";

export class IRStateTracker {
    constructor() {
        this.definiteDeps = new DependencyGraph();
        this.possibleDeps = new DependencyGraph();
        this.knownRegisters = new Map();
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
        console.log("  ALTER ALL");
        this.knownRegisters.clear();
        this.definiteDeps.clear();
    }
    alter(register) {
        const dependents = [...this.definiteDeps.getDependents(register)];
        console.log(`  ALTER ${register}, DEPENDED ON BY [${dependents.join(", ")}]`);
        this.definiteDeps.delete(register);
        this.knownRegisters.delete(register);
        for (const dependent of dependents)
            this.alter(dependent);
    }
    /**
     * @param {Statement} stmt
     * @param {(src: Unary | Binary) => SymbolicExpression | null} createSpecializedExpression
     */
    handleStatement(stmt, createSpecializedExpression = () => null) {
        console.log("\n" + stmt.toString());
        console.log(`  KNOWN ${[...this.knownRegisters].map(([key, value]) => `${key} => ${value}`).join(", ")}`);
        console.log(`  DEFINITE DEPENDENCIES\n${this.definiteDeps}`);

        const resolution = new Map();

        if (stmt instanceof Store) {
            // stores can allow more complex inputs
            const resolved = this.resolveOperand(stmt.src, true);
            resolution.set(stmt.src, resolved);
        }

        const newDependencies = [];

        for (const read of stmt.reads) {
            // other instructions can only allow unary operators
            if (!resolution.has(read))
                resolution.set(read, this.resolveOperand(read, false));

            const resolved = resolution.get(read);

            for (const register of resolved.registers) {
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

            let expr = createSpecializedExpression(src, resolution);
            if (!expr) {
                if (src instanceof Copy) {
                    expr = resolution.get(src.target);
                } else if (src instanceof Unary) {
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
            for (const dep of newDependencies)
                this.definiteDeps.addDependency(dst, dep);
            if (expr && !expr.registers.includes(dst))
                this.knownRegisters.set(dst, expr);
        } else if (stmt instanceof Store) {
            this.alterAll();
        } else if (stmt instanceof Pop) {
            this.alter(stmt.value);
            this.possibleDeps.addDependency(null, stmt.value);
        }

        return resolution;
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