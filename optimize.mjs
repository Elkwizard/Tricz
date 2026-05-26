import { Address, Copy, Jump, Label, LabelDecl, Load, Return, Store, TAC } from "./ir.mjs";

const simplifyStore = fn => {
    for (let i = 0; i < fn.length; i++) {
        const stmt = fn[i];
        if (stmt instanceof Store && stmt.addr instanceof Address) {
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
            stmt.src.target instanceof Address
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

export default function optimize(fn) {
    simplifyStore(fn);
    simplifyLoad(fn);
    removeUnusedLabels(fn);
    removeDeadBlocks(fn);
    return fn;
}