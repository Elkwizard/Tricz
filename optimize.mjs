import { Add, Address, Constant, Copy, Divide, Jump, Label, LabelDecl, Load, Multiply, Return, Store, TAC } from "./ir.mjs";

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


const foldConstants = fn => {
    const folds = {
        Add: (a, b) => a + b,
        Negate: a => -a,
        Divide: (a, b) => Math.trunc(a / b),
        Multiply: (a, b) => a * b,
        Remainder: (a, b) => a % b
    };

    for (let i = 0; i < fn.length; i++) {
        const stmt = fn[i];

        if (!(stmt instanceof TAC)) continue;

        const { dst, src } = stmt;

        const fold = folds[src.constructor.name];
        if (fold && src.reads.every(read => read instanceof Constant)) {
            const result = new Constant(fold(
                ...src.reads.map(read => read.value)
            ));
            fn[i] = new Copy(result).into(dst);
        }
    }
};

const getCommutativeOperands = ({ a, b }) => {
    if (a instanceof Constant)
        return [a, b];

    if (b instanceof Constant)
        return [b, a];

    return [a, b];
};

const foldIdentities = fn => {
    for (let i = 0; i < fn.length; i++) {
        const stmt = fn[i];

        if (!(stmt instanceof TAC)) continue;

        const { dst, src } = stmt;

        if (src instanceof Add) {
            const [a, b] = getCommutativeOperands(src);
            if (a instanceof Constant) {
                if (a.value === 0) {
                    fn[i] = new Copy(b).into(dst);
                }
            }
        } else if (src instanceof Multiply) {
            const [a, b] = getCommutativeOperands(src);
            if (a instanceof Constant) {
                if (a.value === 0) {
                    fn[i] = new Copy(a).into(dst);
                } else if (a.value === 1) {
                    fn[i] = new Copy(b).into(dst);
                }
            }
        } else if (src instanceof Divide) {
            const { a, b } = src;
            if (b instanceof Constant) {
                if (b.value === 1) {
                    fn[i] = new Copy(a).into(dst);
                }
            }
        }
    }
};

export default function optimize(fn) {
    simplifyStore(fn);
    simplifyLoad(fn);
    removeUnusedLabels(fn);
    removeDeadBlocks(fn);
    foldConstants(fn);
    foldIdentities(fn);
    return fn;
}