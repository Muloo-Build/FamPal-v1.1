import { Project, SyntaxKind } from 'ts-morph';

const project = new Project();
const sourceFile = project.addSourceFileAtPath('../components/Dashboard.tsx');
let changes = 0;

let dirty = true;
while (dirty) {
    dirty = false;
    const nodes = sourceFile.getDescendantsOfKind(SyntaxKind.JsxExpression);
    for (const jsxExpr of nodes) {
        if (jsxExpr.wasForgotten()) continue;
        const text = jsxExpr.getText();
        if (text.includes("activeTab === 'activity'") || 
            text.includes("activeTab === 'memories'") || 
            text.includes("activeTab === 'partner'") ||
            text.startsWith("{shareMemory &&")) {
            console.log('Removing JSX expression for length', Math.min(30, text.length));
            jsxExpr.replaceWithText('{null}');
            dirty = true;
            changes++;
            break;
        }
    }
}

dirty = true;
while (dirty) {
    dirty = false;
    const callNodes = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const callExpr of callNodes) {
        if (callExpr.wasForgotten()) continue;
        if (callExpr.getExpression().getText() === 'useEffect') {
            const text = callExpr.getText();
            if (text.includes('syncPartnerThread') || text.includes('ensurePartnerThread')) {
                const stmt = callExpr.getFirstAncestorByKind(SyntaxKind.ExpressionStatement);
                if (stmt && !stmt.wasForgotten()) {
                    console.log('Removing partner thread useEffect');
                    stmt.remove();
                    dirty = true;
                    changes++;
                    break;
                }
            }
        }
    }
}

['handleSendPartnerNote', 'handleAddPartnerPlace', 'handleTagMemoryToPartner', 'handleShareMemoryExternal'].forEach(fnName => {
    const decl = sourceFile.getVariableDeclaration(fnName);
    if (decl && !decl.wasForgotten()) {
        const stmt = decl.getFirstAncestorByKind(SyntaxKind.VariableStatement);
        if (stmt) {
            console.log('Removing function', fnName);
            stmt.remove();
            changes++;
        }
    }
});

const incrementFn = sourceFile.getVariableDeclaration('handleIncrementAiRequests');
if (incrementFn) {
    const tryStmts = incrementFn.getDescendantsOfKind(SyntaxKind.TryStatement);
    for (const t of tryStmts) {
        if (t.getText().includes('savePartnerThreadFamilyPool')) {
           const ifStmt = t.getFirstAncestorByKind(SyntaxKind.IfStatement);
           if (ifStmt && !ifStmt.wasForgotten()) {
               console.log('Removing family pool save block');
               ifStmt.remove();
               changes++;
               break;
           }
        }
    }
}

// Remove missing imports
const importsToRemove = ['./ShareMemory', './MemoryCreate', '../lib/partnerThreads', './ActivityDashboard'];
sourceFile.getImportDeclarations().forEach(imp => {
    if (importsToRemove.includes(imp.getModuleSpecifierValue())) {
        console.log('Removing import', imp.getModuleSpecifierValue());
        imp.remove();
        changes++;
    }
});

sourceFile.saveSync();
console.log(`Cleanup complete. Made ${changes} changes`);
