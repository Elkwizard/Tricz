import util from "node:util";
import compile from "./compile.mjs";
import path from "node:path";
import fs from "node:fs";

const {
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
    console.log(fixedPrecision);
    const file = positionals[0];
    const source = fs.readFileSync(file, "utf-8");
    const result = compile(source, {
        filename: file,
        fixedPrecision: +(fixedPrecision ?? "10")
    });

    output ??= path.join(path.dirname(file), path.basename(file, path.extname(file)) + ".zez");
    fs.writeFileSync(output, result, "utf-8");
} catch (err) {
    console.error("Fatal Error:", err.stack);
    process.exit(1);
}