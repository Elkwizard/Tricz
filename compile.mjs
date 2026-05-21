import clean from "./clean.mjs";
import { parse } from "./grammar/parse.mjs";
import lower from "./lower.mjs";
import prettyPrint from "./pretty.mjs";

export default function compile(source, filename) {
	let root = parse(source, { filename });
	root = clean(root);
	root = lower(root);
	console.log(prettyPrint(root));
	// console.dir(root.removeMetadata(), {depth: null});
}