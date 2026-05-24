import clean from "./clean.mjs";
import { parse } from "./grammar/parse.mjs";
import lower from "./lower.mjs";
import lowerResolved from "./lowerResolved.mjs";
import prettyPrint from "./pretty.mjs";
import resolveReferences from "./resolve.mjs";
import toIR from "./toIR.mjs";
import typeCheck from "./typeCheck.mjs";

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
    // console.dir(root.removeMetadata(), {depth: null});
}