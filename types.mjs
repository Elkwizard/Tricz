export class Type {
    get integral() {
        return false;
    }
    get numeric() {
        return this.integral;
    }
    equals(other) {
        return this === other;
    }
    convertibleTo(other) {
        return this.equals(other);
    }
    static common(a, b) {
        if (a.equals(b)) return a;

        if (a instanceof PrimitiveType && b instanceof PrimitiveType)
            return a.numeric && b.numeric ? PrimitiveType.FIXED : null;

        return null;
    }
}

export class PrimitiveType extends Type {
    static INT = new PrimitiveType("int");
    static FIXED = new PrimitiveType("fixed");
    static BOOL = new PrimitiveType("bool");
    static VOID = new PrimitiveType("void");

    constructor(name) {
        super();
        this.name = name;
    }

    get integral() {
        return this === PrimitiveType.INT;
    }

    get numeric() {
        return this.integral || this === PrimitiveType.FIXED;
    }

    convertibleTo(other) {
        if (this.equals(other))
            return true;

        return this.numeric && other.numeric;
    }

    toString() {
        return this.name;
    }
}

export class PointerType extends Type {
    constructor(target) {
        super();
        this.target = target;
    }
    get numeric() {
        return true;
    }
    get integral() {
        return true;
    }
    equals(other) {
        if (!(other instanceof PointerType))
            return false;

        return other.target.equals(this.target);
    }
    convertibleTo(other) {
        return other.integral;
    }
    toString() {
        return `&${this.target}`;
    }
}

export class ArrayType extends Type {
    constructor(element, size) {
        super();
        this.element = element;
        this.size = size;
    }
    equals(other) {
        if (!(other instanceof ArrayType))
            return false;

        return  other.element.equals(this.element) &&
                other.size === this.size;
    }
    toString() {
        return `${this.element}[${this.size}]`;
    }
}

export class FunctionType extends Type {
    constructor(result, params) {
        super();
        this.result = result;
        this.params = params;
    }
    get integral() {
        return true;
    }
    equals(other) {
        if (!(other instanceof FunctionType))
            return false;

        return	this.result.equals(other.result) &&
                this.params.length === other.params.length &&
                this.params.every((param, i) => param.equals(other.params[i]))
    }
    convertibleTo(other) {
        return other.integral || this.equals(other);
    }
    toString() {
        return `${this.result} (${this.params.join(", ")})`;
    }
}