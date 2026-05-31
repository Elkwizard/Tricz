import { Statement } from "./ir.mjs";

/**
 * @param {Statement[]} stmts
 */
export const findAddressed = stmts => {
    return new Set(
        stmts
            .flatMap(stmt => stmt.addresses)
            .map(address => address.register)
    );
};

/**
 * @param {Statement[][]} fns 
 */
export const analyze = fns => {
    const stmts = fns.flat();
    return {
        addressed: new Set([...findAddressed(stmts)].filter(reg => reg.global))
    };
};

/**
 * @typedef {ReturnType<typeof analyze>} Analysis
 */