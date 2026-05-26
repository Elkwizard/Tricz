import { Break, Deref, Instruction, Literal, Negate, Sign, ZERO } from "./zez.mjs";

const removeNullAdds = zez => zez.filter(inst => {
    return !(inst.src instanceof Literal && inst.src.value === 0);
});

const padEmptyLines = zez => {
    const result = [];
    for (const inst of zez) {
        if (inst instanceof Break && result.at(-1) instanceof Break)
            result.push(new Instruction(ZERO, ZERO));
        result.push(inst);
    }
    return result;
};

/**
 * @param {(Instruction | Break)[]} zez 
 */
export default function optimizeZEZ(zez) {
    // zez = removeNullAdds(zez);
    // zez = padEmptyLines(zez);
    return zez;
}