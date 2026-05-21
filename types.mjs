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
}

export class PrimitiveType {
    static INT = new PrimitiveType("int");
    static FIXED = new PrimitiveType("fixed");
    static BOOL = new PrimitiveType("bool");
    static VOID = new PrimitiveType("void");

    constructor(name) {
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
}

export class PointerType {
    constructor(target) {
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
}

export class ArrayType {
    constructor(element, size) {
        this.element = element;
        this.size = size;
    }
    equals(other) {
        if (!(other instanceof ArrayType))
            return false;

        return  other.element.equals(this.element) &&
                other.size === this.size;
    }
}

export class FunctionType {
    constructor(result, params) {
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
}