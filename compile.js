import { analyze } from "./analyze.js";
import clean from "./clean.js";
import codegen from "./codegen.js";
import config from "./config.js";
import { parse } from "./grammar/parse.js";
import lower from "./lower.js";
import lowerResolved from "./lowerResolved.js";
import optimize from "./optimize.js";
import optimizeZEZ from "./optimizeZEZ.js";
import prettyPrint from "./pretty.js";
import resolveReferences from "./resolve.js";
import toIR from "./toIR.js";
import typeCheck from "./typeCheck.js";
import { stringify } from "./zez.js";

const logPhase = (phase, data) => {
    if (!config.log.phases?.includes(phase))
        return;

    console.log(`=== ${phase.toUpperCase()} ===`);

    if (Array.isArray(data)) {
        console.log(data.map(fn => fn.join("\n")).join("\n\n"));
    } else {
        console.log(prettyPrint(data));
    }
};

export default function compile(root, config) {
    root = lower(root);
    logPhase("lowered", root);
    root = resolveReferences(root);
    root = lowerResolved(root);
    logPhase("resolved", root);
    typeCheck(root);
    logPhase("typed", root);

    const ir = toIR(root, config);
    logPhase("ir", ir);
    const analysis = analyze(ir);
    const optimized = ir.map(fn => optimize(fn, analysis));
    logPhase("optimized", optimized);
    // return;
    let zez = codegen(optimized);
    console.log(zez.length);
    zez = optimizeZEZ(zez);
    console.log(zez.length);
    return stringify(zez);
}