import { findAddressed } from "./analyze.mjs";
// import { createCFG } from "./cfg.mjs";
import { Add, Address, CompareJump, Constant, Copy, Divide, Jump, Label, LabelDecl, Load, Multiply, Negate, Push, Register, Return, StackOperation, Store, TAC, Unary } from "./ir.mjs";
import { IRStateTracker, SymbolicOperand, SymbolicOperator } from "./IRStateTracker.mjs";
import { $ } from "./pattern.mjs";
import { PrimitiveType } from "./types.mjs";

class Optimization {
    constructor(stmts, analysis) {
        this.stmts = stmts;
        this.analysis = analysis;
        this.setup();
    }
    setup() { }
    evaluate(stmt, index) { }
    apply() {
        for (let i = 0; i < this.stmts.length; i++) {
            const stmt = this.stmts[i];
            const result = this.evaluate(stmt, i);
            if (!result) continue;
            if ("remove" in result) {
                const replace = result.replace ?? [];
                this.stmts.splice(i, result.remove, ...replace);
                i += result.length - result.remove;
            } else {
                this.stmts.splice(i, 1, ...result);
                i += result.length - 1;
            }
        }
    }
    static use(stmts, analysis) {
        new this(stmts, analysis).apply();
    }
}

class SimplifyStore extends Optimization {
    evaluate(stmt) {
        if (
            stmt instanceof Store &&
            stmt.addr instanceof Address &&
            stmt.addr.register.size === stmt.src.size
        ) {
            return [new Copy(stmt.src).into(stmt.addr.register)];
        }
    }
}

class SimplifyLoad extends Optimization {
    evaluate(stmt) {
        if (
            stmt instanceof TAC &&
            stmt.src instanceof Load &&
            stmt.src.target instanceof Address &&
            stmt.dst.size === stmt.src.target.register.size
        ) {
            return [new Copy(stmt.src.target.register).into(stmt.dst)];
        }
    }
}

class RemoveUnusedLabels extends Optimization {
    setup() {
        this.usedLabels = new Set(this.stmts.flatMap(stmt => stmt.labels));
    }
    evaluate(stmt) {
        if (
            stmt instanceof LabelDecl &&
            !this.usedLabels.has(stmt.label) &&
            !stmt.label.global
        ) return [];
    }
}

class RemoveDeadBlocks extends Optimization {
    evaluate(stmt, i) {
        if (!(stmt instanceof Jump || stmt instanceof Return))
            return;

        const fn = this.stmts;
        let j = i + 1;
        while (j < fn.length && !(fn[j] instanceof LabelDecl))
            j++;

        if (fn[j] instanceof LabelDecl)
            return { remove: j - i, replace: [stmt] };

        return { remove: j - i + 1, replace: [stmt] };
    }
}

class FactorProducts extends Optimization {
    evaluate(stmt) {
        if (!(stmt instanceof TAC)) return;
        const { dst, src } = stmt;
        if (!(src instanceof Multiply)) return;
        const [a, b] = orderCommutativeOperands([src.a, src.b]);
        if (!(a instanceof Constant)) return;
        if (b === a) return;

        // create accumulator register
        const acc = new Register(PrimitiveType.INT, false, "acc*");

        // perform decomposition into powers of 2
        let factor = Math.abs(a.value);

        const stmts = [
            (a.value < 0 ? new Negate(b) : new Copy(b)).into(acc),
            new Copy(new Constant(0)).into(dst),
        ];

        while (factor) {
            if (factor & 1)
                stmts.push(new Add(dst, acc).into(dst));
            factor >>= 1;
            stmts.push(new Add(acc, acc).into(acc));
        }

        return stmts;
    }
}

class RemoveStupidJumps extends Optimization {
    evaluate(stmt, i) {
        if (!(stmt instanceof Jump || stmt instanceof CompareJump))
            return;

        const fn = this.stmts;
        const { label } = stmt;
        const seen = new Set();

        for (let j = i + 1; fn[j] instanceof LabelDecl; j++)
            seen.add(fn[j].label);

        if (seen.has(label))
            return [];
    }
}

export const orderCommutativeOperands = ([a, b]) => {
    if (a instanceof Constant)
        return [a, b];

    if (b instanceof Constant)
        return [b, a];

    return [a, b];
};

$.register(Add, orderCommutativeOperands);
$.register(Multiply, orderCommutativeOperands);
$.register(Constant);
$.register(Divide);
$.register(Negate);

const foldExpression = (() => {
    const { Add, Multiply, Divide, Negate, Constant, x, y, a } = $;

    const patterns = [
        Add(Constant(x), Constant(y)) ,_=> new Copy(new Constant(_.x + _.y)),
        Add(Constant(0), x) ,_=> new Copy(_.x),

        Multiply(Constant(0), a) ,_=> new Copy(new Constant(0)),
        Multiply(Constant(1), a) ,_=> new Copy(_.a),
        Multiply(Constant(-1), a) ,_=> new Negate(_.a),
        Multiply(Constant(x), Constant(y)) ,_=> new Copy(new Constant(_.x * _.y)),

        Divide(a, Constant(1)) ,_=> new Copy(_.a),
        Divide(a, Constant(-1)) ,_=> new Negate(_.a),
        Divide(Constant(x), Constant(y)) ,_=> new Copy(new Constant(Math.trunc(_.x / _.y) || 0)),

        Negate(Constant(x)) ,_=> new Copy(new Constant(-_.x)),
    ];

    return src => {
        for (let i = 0; i < patterns.length; i += 2) {
            const find = patterns[i];
            const replace = patterns[i + 1];
            const context = {};
            if (find.match(src, context))
                return replace(context);
        }

        return src;
    };
})();

const propagateStatement = (stmt, resolution) => {
    // console.log(`STMT : ${stmt} {${stmt.reads.map(read => resolution.get(read)).join(", ")}}`);

    // wide read / copy operation into copy instruction
    if (stmt instanceof TAC && stmt.src instanceof Copy) {
        let expr = resolution.get(stmt.src.target);
        if (!(expr instanceof SymbolicOperator))
            expr = new SymbolicOperator(Copy, [expr]);

        return new expr.type(...expr.operands.map(op => op.operand)).into(stmt.dst);
    }

    // narrow reads
    const [a, b] = stmt.reads.map(read => resolution.get(read).operand);

    if (stmt instanceof TAC) {
        const { dst, src } = stmt;

        if (src instanceof Unary)
            return new src.constructor(a).into(dst);

        return new src.constructor(a, b).into(dst);
    }

    if (stmt instanceof Store)
        return new Store(a, b);

    if (stmt instanceof Push)
        return new Push(a);

    if (stmt instanceof CompareJump)
        return new CompareJump(a, stmt.compare, b);

    return stmt;
}

const foldStatement = stmt => {
    if (!(stmt instanceof TAC))
        return stmt;

    return foldExpression(stmt.src).into(stmt.dst);
};

const createStateTracker = (fn, analysis) => {
    const addressed = findAddressed(fn).union(analysis.addressed);
    return new IRStateTracker(addressed);
};

class PropagateAndFold extends Optimization {
    setup() {
        this.tracker = createStateTracker(this.stmts, this.analysis);
    }
    apply() {
        const fn = this.stmts;
        for (let i = 0; i < fn.length; i++) {
            const stmt = fn[i];
            const wideReads = new Set();
            if (stmt instanceof TAC && stmt.src instanceof Copy) wideReads.add(stmt.src.target);
            const resolution = this.tracker.resolveStatement(stmt, wideReads);

            const propagated = propagateStatement(stmt, resolution);
            const folded = foldStatement(propagated);
            fn[i] = folded;

            this.tracker.handleStatement(
                folded,
                this.tracker.resolveStatement(folded),
                PropagateAndFold.createSpecializedExpression
            );
        }
    }
    static createSpecializedExpression(src, resolution) {
        if (src instanceof Copy)
            return resolution.get(src.target);

        return null;
    }
}

class RemoveDeadAssignments extends Optimization {
    setup() {
        const fn = this.stmts;
        const tracker = createStateTracker(fn, this.analysis);

        for (const register of fn.flatMap(stmt => stmt.registers))
            if (register.global)
                tracker.addNecessary(register);

        for (const address of fn.flatMap(stmt => stmt.addresses))
            tracker.addNecessary(address.register);

        for (const stmt of fn)
            tracker.handleStatement(stmt, tracker.resolveStatement(stmt));

        this.necessary = tracker.getNecessaryRegisters();
    }
    evaluate(stmt) {
        if (stmt instanceof TAC && !this.necessary.has(stmt.dst))
            return [];
    }
}

export default function optimize(fn, analysis) {
    for (let n = 0; n < 2; n++) {
        RemoveStupidJumps.use(fn, analysis);
        SimplifyStore.use(fn, analysis);
        SimplifyLoad.use(fn, analysis);
        RemoveUnusedLabels.use(fn, analysis);
        RemoveDeadBlocks.use(fn, analysis);
        PropagateAndFold.use(fn, analysis);
        FactorProducts.use(fn, analysis);
    }
    RemoveDeadAssignments.use(fn, analysis);

    // createCFG(fn);

    return fn;
}