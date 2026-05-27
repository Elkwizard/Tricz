class Pattern {
    match(expr, context) { }
}

class TypePattern extends Pattern {
    constructor(type, patterns, order = x => x) {
        super();
        this.type = type;
        this.patterns = patterns;
        this.order = order;
    }
    match(value, context) {
        if (!(value instanceof this.type))
            return false;

        const values = this.order(Object.values(value));
        if (values.length !== this.patterns.length)
            return false;

        for (let i = 0; i < values.length; i++) {
            const pattern = this.patterns[i];
            if (pattern instanceof Pattern) {
                if (!pattern.match(values[i], context))
                    return false;
            } else {
                if (pattern !== values[i])
                    return false;
            }
        }

        return true;
    }
}

class PlaceholderPattern extends Pattern {
    constructor(name) {
        super();
        this.name = name;
    }
    match(value, context) {
        context[this.name] = value;
        return true;
    }
}

const registeredTypes = new Map();

export const $ = new Proxy({}, {
    get: (_, key) => {
        if (key === "register")
            return (type, order) => {
                registeredTypes.set(type.name, { type, order });
            };

        if (registeredTypes.has(key)) {
            const { type, order } = registeredTypes.get(key);
            const patternFn = function (...patterns) {
                if (new.target === patternFn)
                    return new type(...patterns);
                return new TypePattern(type, patterns, order);
            };
            return patternFn;
        }

        return new PlaceholderPattern(key);
    }
});