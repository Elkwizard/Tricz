import { Add, Address, Constant, Copy, Divide, Jump, Label, LabelDecl, Load, Multiply, Negate, Register, Return, Store, TAC } from "./ir.mjs";
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
                } else if (a.value === -1) {
                    fn[i] = new Negate(b).into(dst);
                }
            }
        } else if (src instanceof Divide) {
            const { a, b } = src;
            if (b instanceof Constant) {
                if (b.value === 1) {
                    fn[i] = new Copy(a).into(dst);
                } else if (b.value === -1) {
                    fn[i] = new Negate(a).into(dst);
                }
            }
        }
    }
};

const factorProducts = fn => {
    for (let i = 0; i < fn.length; i++) {
        const stmt = fn[i];
        if (!(stmt instanceof TAC)) continue;
        const { dst, src } = stmt;
        if (!(src instanceof Multiply)) continue;
        const [a, b] = getCommutativeOperands(src);
        if (!(a instanceof Constant)) continue;
        if (b === a) continue;

        // create registers
        const result = new Register(PrimitiveType.INT, false, "result*");
        const temp = new Register(PrimitiveType.INT, false, "temp*");

        // perform factorization
        let factor = a.value;
        
        const stmts = [
            new Copy(b).into(result)
        ];

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

export default function optimize(fn) {
    simplifyStore(fn);
    simplifyLoad(fn);
    removeUnusedLabels(fn);
    removeDeadBlocks(fn);
    foldConstants(fn);
    foldIdentities(fn);
    factorProducts(fn);
    return fn;
}