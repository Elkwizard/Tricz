import clean from "./clean.mjs";
import codegen from "./codegen.mjs";
import { parse } from "./grammar/parse.mjs";
import lower from "./lower.mjs";
import lowerResolved from "./lowerResolved.mjs";
import optimize from "./optimize.mjs";
import optimizeZEZ from "./optimizeZEZ.mjs";
import prettyPrint from "./pretty.mjs";
import resolveReferences from "./resolve.mjs";
import toIR from "./toIR.mjs";
import typeCheck from "./typeCheck.mjs";
import { stringify } from "./zez.mjs";

export default function compile(source, config) {
    let root = parse(source, { filename: config.filename });
    root = clean(root);
    root = lower(root);
    console.log(prettyPrint(root));
    root = resolveReferences(root);
    root = lowerResolved(root);
    console.log(prettyPrint(root));
    typeCheck(root);
    console.log(prettyPrint(root));

    const ir = toIR(root, config);
    const optimized = ir.map(optimize);
    console.log(optimized.map(fn => fn.join("\n")).join("\n\n"));
    let zez = codegen(optimized);
    console.log(zez.length);
    zez = optimizeZEZ(zez);
    console.log(zez.length);
    return stringify(zez);
}