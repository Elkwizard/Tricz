import fs from "node:fs";
import path from "node:path";
import { parse, AST } from "./grammar/parse.mjs";
import clean from "./clean.mjs";

const { make } = AST;

export default function resolveIncludes(filename) {
    const found = new Set();
    
    const resolveFile = filename => {
        filename = path.resolve(filename);
        if (found.has(filename)) return null;
        found.add(filename);

        const content = fs.readFileSync(filename, "utf-8");
        let root = parse(content, { filename });
        root = clean(root);

        const includeDirectory = path.dirname(filename);

        const included = root.includes
            .map(include => {
                let includePath = JSON.parse(include.path) + ".tricz";
                if (!path.isAbsolute(includePath))
                    includePath = path.resolve(includeDirectory, includePath);
                
                return resolveFile(includePath);
            })
            .filter(Boolean)
            .flatMap(module => module.decls);

        root.decls.unshift(...included);

        return root;
    };

    return resolveFile(filename);
}