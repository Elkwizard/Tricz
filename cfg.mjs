import { Branch, LabelDecl, Statement } from "./ir.mjs";

/**
 * @param {Statement[]} stmts
 */
export function findLinearBlocks(stmts) {
    const blocks = [];
    for (let i = 0; i < stmts.length;) {
        const block = [];
        while (i < stmts.length) {
            const stmt = stmts[i];
            if (stmt instanceof LabelDecl && block.length && !(block.at(-1) instanceof LabelDecl))
                break;
            
            block.push(stmt);
            i++;

            if (stmt instanceof Branch)
                break;
        }
        blocks.push(block);
    }
    return blocks;
}