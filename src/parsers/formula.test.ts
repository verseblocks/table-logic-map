import { describe, expect, it } from 'vitest';
import { extractFormulaColumns } from './formula';

const known = new Set(['contoso_budget', 'contoso_spent', 'contoso_name', 'budgetamount', 'name', 'statecode']);

describe('extractFormulaColumns', () => {
    it('matches plain logical-name tokens case-insensitively, sorted and unique', () => {
        expect(extractFormulaColumns('contoso_budget - contoso_spent', known)).toEqual(['contoso_budget', 'contoso_spent']);
        expect(extractFormulaColumns('If(Contoso_Budget > 0, contoso_budget / CONTOSO_SPENT, 0)', known)).toEqual(['contoso_budget', 'contoso_spent']);
        expect(extractFormulaColumns('ThisRecord.contoso_budget * 2', known)).toEqual(['contoso_budget']);
    });

    it('ignores tokens inside double-quoted string literals (including "" escapes)', () => {
        expect(extractFormulaColumns('Concatenate("contoso_budget: ", Text(contoso_spent))', known)).toEqual(['contoso_spent']);
        expect(extractFormulaColumns('"say ""contoso_budget"" here" & contoso_name', known)).toEqual(['contoso_name']);
        expect(extractFormulaColumns('"only strings here: contoso_budget"', known)).toEqual([]);
    });

    it('ignores comments', () => {
        expect(extractFormulaColumns('contoso_budget // uses contoso_spent later\n', known)).toEqual(['contoso_budget']);
        expect(extractFormulaColumns('/* contoso_spent */ contoso_budget', known)).toEqual(['contoso_budget']);
    });

    it('does not match partial tokens or unknown names', () => {
        expect(extractFormulaColumns('contoso_budget2 + xcontoso_spent', known)).toEqual([]);
        expect(extractFormulaColumns('Sum(contoso_other)', known)).toEqual([]);
    });

    it('resolves single-quoted display names to logical names (prefix-insensitive, spaces removed)', () => {
        expect(extractFormulaColumns("'Budget Amount' * 2", known)).toEqual(['budgetamount']);
        expect(extractFormulaColumns("'Budget' - 'Spent'", known)).toEqual(['contoso_budget', 'contoso_spent']);
        expect(extractFormulaColumns("'contoso_budget' + 1", known)).toEqual(['contoso_budget']);
        // Words inside the quoted identifier are not matched on their own.
        expect(extractFormulaColumns("'Name Of Thing'", known)).toEqual([]);
        expect(extractFormulaColumns("'Unknown Field'", known)).toEqual([]);
    });

    it('prefers an exact logical name over a prefix-stripped match', () => {
        expect(extractFormulaColumns("'Name'", known)).toEqual(['name']);
        expect(extractFormulaColumns("'name' & contoso_name", known)).toEqual(['contoso_name', 'name']);
    });

    it('returns an empty list for empty inputs', () => {
        expect(extractFormulaColumns('', known)).toEqual([]);
        expect(extractFormulaColumns('   ', known)).toEqual([]);
        expect(extractFormulaColumns(null, known)).toEqual([]);
        expect(extractFormulaColumns(undefined, known)).toEqual([]);
        expect(extractFormulaColumns('contoso_budget', new Set())).toEqual([]);
    });
});
