export class Literal {
    constructor(value) {
        this.value = value;
    }
    toString() {
        return String(this.value);
    }
    replace(mapping) {
        return this;
    }
}

export class Placeholder {
    constructor(key) {
        this.key = key;
    }
    replace(mapping) {
        if (mapping.has(this.key))
            return mapping.get(this.key);
        return this;
    }
}

export class Operator {
    constructor(target) {
        this.target = target;
    }
    replace(mapping) {
        this.target = this.target.replace(mapping);
        return this;
    }
}

export class Negate extends Operator {
    toString() {
        return `-${this.target}`;
    }
}

export class Sign extends Operator {
    toString() {
        return `(${this.target})`;
    }
}

export class Deref extends Operator {
    toString() {
        return `[${this.target}]`;
    }
}

export class Instruction {
    constructor(dst, src) {
        this.dst = dst;
        this.src = src;
    }
    replace(mapping) {
        this.dst = this.dst.replace(mapping);
        this.src = this.src.replace(mapping);
    }
    toString() {
        return `${this.dst} ${this.src}`;
    }
}

export class Break {
    replace(mapping) { }
    toString() {
        return "EOL";
    }
}

export const ZERO = new Literal(0);

export const add = (a, b) => {
    return addLiteral(a, new Deref(b));
};
export const addLiteral = (a, b) => {
    return [new Instruction(a, b)];
};
export const set = (a, b) => {
    return setLiteral(a, new Deref(b));
};
export const setLiteral = (a, b) => {
    return [
        new Instruction(a, new Negate(new Deref(a))),
        new Instruction(a, b)
    ];
};
export const jumpOffset = offsetExp => {
    return [
        new Instruction(ZERO, offsetExp),
        new Instruction(ZERO, new Literal(-1)),
        new Break()
    ];
};
export const jumpOffsetLiteral = offset => {
    return [
        new Instruction(ZERO, new Literal(offset)),
        new Break()
    ];
};
export const jumpLiteral = lineNumber => {
    return [
        ...set(ZERO, new Literal(lineNumber - 1)),
        new Break()
    ];
};
export const jump = lineNumberExp => {
    return [
        ...set(ZERO, lineNumberExp),
        new Instruction(ZERO, new Literal(-1)),
        new Break()
    ];
};