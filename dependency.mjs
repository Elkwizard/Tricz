export class DependencyGraph {
    constructor() {
        this.nodeToDependencies = new Map();
        this.nodeToDependents = new Map();
    }
    getAllDependencies(node) {
        const found = new Set();

        let toExplore = new Set([node]);
        while (toExplore.size) {
            const toExploreNext = new Set();
            for (const node of toExplore) {
                if (!found.has(node)) {
                    found.add(node);

                    for (const dependency of this.getDependencies(node))
                        toExploreNext.add(dependency);
                }
            }
            toExplore = toExploreNext;
        }

        return found;
    }
    addDependency(dependent, dependency) {
        if (!this.nodeToDependencies.has(dependent))
            this.nodeToDependencies.set(dependent, new Set());
        this.nodeToDependencies.get(dependent).add(dependency);

        if (!this.nodeToDependents.has(dependency))
            this.nodeToDependents.set(dependency, new Set());
        this.nodeToDependents.get(dependency).add(dependent);
    }
    clear() {
        this.nodeToDependencies.clear();
        this.nodeToDependents.clear();
    }
    delete(node) {
        const dependencies = [...this.getDependencies(node)];
        const dependents = [...this.getDependents(node)];

        for (const dependency of dependencies)
            this.nodeToDependents.get(dependency).delete(node);

        for (const dependent of dependents)
            this.nodeToDependencies.get(dependent).delete(node);

        this.nodeToDependencies.delete(node);
        this.nodeToDependents.delete(node);
    }
    getDependents(node) {
        return this.nodeToDependents.get(node) ?? new Set();
    }
    getDependencies(node) {
        return this.nodeToDependencies.get(node) ?? new Set();
    }
    toString() {
        return [
            ...[...this.nodeToDependencies]
                .flatMap(([node, dependencies]) => [...dependencies].map(
                    dependency => `${node} -> ${dependency}`
                ))
        ].map(line => `  ${line}`).join("\n");
    }
}