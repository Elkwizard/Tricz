import { Add, Address, CompareJump, Constant, Copy, Divide, Jump, Label, LabelDecl, Load, Multiply, Negate, Push, Register, Return, StackOperation, Store, TAC, Unary } from "./ir.mjs";
import { IRStateTracker, SymbolicOperand, SymbolicOperator } from "./IRStateTracker.mjs";
import { $ } from "./pattern.mjs";
import { PrimitiveType } from "./types.mjs";

const simplifyStore = fn => {
    for (let i = 0; i < fn.length; i++) {
        const stmt = fn[i];
        if (
            stmt instanceof Store &&
            stmt.addr instanceof Address &&
            stmt.addr.register.size === stmt.src.size
        ) {
            fn[i] = new Copy(stmt.src).into(stmt.addr.register);
        }
    }
};

const simplifyLoad = fn => {
    for (let i = 0; i < fn.length; i++) {
        const stmt = fn[i];
        if (
            stmt instanceof TAC &&
            stmt.src instanceof Load &&
            stmt.src.target instanceof Address &&
            stmt.dst.size === stmt.src.target.register.size
        ) {
            fn[i] = new Copy(stmt.src.target.register).into(stmt.dst);
        }
    }
};

const removeUnusedLabels = fn => {
    const usedLabels = new Set(fn.flatMap(stmt => stmt.labels));

    for (let i = 0; i < fn.length; i++) {
        const stmt = fn[i];
        if (
            stmt instanceof LabelDecl &&
            !usedLabels.has(stmt.label) &&
            !stmt.label.global
        ) {
            fn.splice(i, 1);
            i--;
        }
    }
};

const removeDeadBlocks = fn => {
    for (let i = 0; i < fn.length; i++) {
        const stmt = fn[i];
        if (stmt instanceof Jump || stmt instanceof Return) {
            let j = i + 1;
            while (j < fn.length && !(fn[j] instanceof LabelDecl))
                j++;
            
            let toRemove;
            if (fn[j] instanceof LabelDecl) {
                toRemove = j - i - 1;
            } else {
                toRemove = j - i;
            }
            fn.splice(i + 1, toRemove);
            i = j - 1;
        }
    }
};

export const orderCommutativeOperands = ([a, b]) => {
    if (a instanceof Constant)
        return [a, b];

    if (b instanceof Constant)
        return [b, a];

    return [a, b];
};

const factorProducts = fn => {
    for (let i = 0; i < fn.length; i++) {
        const stmt = fn[i];
        if (!(stmt instanceof TAC)) continue;
        const { dst, src } = stmt;
        if (!(src instanceof Multiply)) continue;
        const [a, b] = orderCommutativeOperands([src.a, src.b]);
        if (!(a instanceof Constant)) continue;
        if (b === a) continue;

        // create registers
        const result = new Register(PrimitiveType.INT, false, "result*");
        const temp = new Register(PrimitiveType.INT, false, "temp*");

        // perform factorization
        let factor = Math.abs(a.value);
        
        const stmts = [(a.value > 0 ? new Copy(b) : new Negate(b)).into(result)];

        for (let n = 2; factor > 1; n++) {
            while (factor % n === 0) {
                factor /= n;

                // multiply by n
                let doubles = Math.round(Math.log2(n));
                let correction = n - 2 ** doubles;

                if (n === 3) {
                    correction = 1;
                    doubles--;
                }

                if (doubles > 30 || Math.abs(correction) > 30) {
                    stmts.push(new Multiply(result, new Constant(n)).into(result));
                    continue;
                }

                if (correction < 0) {
                    stmts.push(new Negate(result).into(temp));
                } else if (correction > 0) {
                    stmts.push(new Copy(result).into(temp));
                }

                for (let i = 0; i < doubles; i++)
                    stmts.push(new Add(result, result).into(result));

                for (let i = 0; i < Math.abs(correction); i++)
                    stmts.push(new Add(result, temp).into(result));
            }
        }

        stmts.push(new Copy(result).into(dst));

        // replace instruction
        fn.splice(i, 1, ...stmts);
        i += stmts.length - 1;
    }
};

const removeStupidJumps = fn => {
    for (let i = 0; i < fn.length; i++) {
        const stmt = fn[i];
        if (!(stmt instanceof Jump || stmt instanceof CompareJump))
            continue;

        const { label } = stmt;

        const seen = new Set();

        for (let j = i + 1; fn[j] instanceof LabelDecl; j++)
            seen.add(fn[j].label);

        if (seen.has(label)) {
            fn.splice(i, 1);
            i--;
        }
    }
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
        Divide(Constant(x), Constant(y)) ,_=> new Copy(new Constant(Math.trunc(_.x / _.y))),
        
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

const foldStatement = (stmt) => {
    if (!(stmt instanceof TAC))
        return stmt;

    return foldExpression(stmt.src).into(stmt.dst);
};

const propagateAndFold = fn => {
    const tracker = new IRStateTracker();
    
    for (let i = 0; i < fn.length; i++) {
        const stmt = fn[i];
        const wideReads = new Set();
        if (stmt instanceof TAC && stmt.src instanceof Copy) wideReads.add(stmt.src.target);
        const resolution = tracker.resolveStatement(stmt, wideReads);
        
        const propagated = propagateStatement(stmt, resolution);
        const folded = foldStatement(propagated);
        fn[i] = folded;

        tracker.handleStatement(folded, tracker.resolveStatement(folded));
    }
};

const removeDeadAssignments = fn => {
    const tracker = new IRStateTracker();

    for (const register of fn.flatMap(stmt => stmt.registers))
        if (register.global)
            tracker.addNecessary(register);

    for (const address of fn.flatMap(stmt => stmt.addresses))
        tracker.addNecessary(address.register);

    for (const stmt of fn)
        tracker.handleStatement(stmt, tracker.resolveStatement(stmt));
    
    const necessary = tracker.getNecessaryRegisters();

    for (let i = 0; i < fn.length; i++) {
        const stmt = fn[i];

        if (stmt instanceof TAC && !necessary.has(stmt.dst)) {
            fn.splice(i, 1);
            i--;
        }
    }
};

export default function optimize(fn) {
    removeStupidJumps(fn);
    for (let n = 0; n < 2; n++) {
        simplifyStore(fn);
        simplifyLoad(fn);
        removeUnusedLabels(fn);
        removeDeadBlocks(fn);
        propagateAndFold(fn);
        factorProducts(fn);
    }
    removeDeadAssignments(fn);
    return fn;
}