import { Address, Copy, LabelDecl, Load, Store, TAC } from "./ir.mjs";

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

export default function optimize(fn) {
    simplifyStore(fn);
    simplifyLoad(fn);
    removeUnusedLabels(fn);
    return fn;
}