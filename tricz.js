import util from "node:util";
import compile from "./compile.js";
import path from "node:path";
import fs from "node:fs";
import resolveIncludes from "./includes.js";

let {
    values: {
        output,
        "fixed-precision": fixedPrecision
    },
    positionals
} = util.parseArgs({
    options: {
        output: {
            short: "o",
            type: "string"
        },
        "fixed-precision": {
            short: "p",
            type: "string"
        }
    },
    allowPositionals: true
});

if (positionals.length !== 1) {
    console.error("Must provide one input file");
    process.exit(1);
}

try {
    const file = positionals[0];
    const root = resolveIncludes(file);
    const result = compile(root, {
        fixedPrecision: +(fixedPrecision ?? "3")
    });

    output ??= path.join(path.dirname(file), path.basename(file, path.extname(file)) + ".zez");
    fs.writeFileSync(output, result, "utf-8");
} catch (err) {
    console.error("Fatal Error:", err.stack);
    process.exit(1);
}