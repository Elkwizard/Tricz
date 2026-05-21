import clean from "./clean.mjs";
import { parse } from "./grammar/parse.mjs";
import lower from "./lower.mjs";
import lowerResolved from "./lowerResolved.mjs";
import prettyPrint from "./pretty.mjs";
import resolveReferences from "./resolve.mjs";
import typeCheck from "./typeCheck.mjs";

export default function compile(source, filename) {
    let root = parse(source, { filename });
    root = clean(root);
    console.log(prettyPrint(root));
    root = lower(root);
    root = resolveReferences(root);
    root = lowerResolved(root);
    console.log(prettyPrint(root));
    typeCheck(root);
    console.log(prettyPrint(root));
    // console.dir(root.removeMetadata(), {depth: null});
}