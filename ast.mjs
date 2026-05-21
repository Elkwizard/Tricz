import { AST, parse } from "./grammar/parse.mjs";

const { make } = AST;

export const makeReference = decl => {
    const result = make.Reference(decl.name);
    result._decl = decl;
    return result;
};

export { AST };