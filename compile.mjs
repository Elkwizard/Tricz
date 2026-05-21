import clean from "./clean.mjs";
import { parse } from "./grammar/parse.mjs";
import lower from "./lower.mjs";

export default function compile(source, filename) {
	let root = parse(source, { filename });
	root = clean(root);
	root = lower(root);
	console.dir(root.removeMetadata(), {depth: null});
}