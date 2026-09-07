/** One Fluent icon per LogicKind (see theme.ts for the label). */
import {
    AppsRegular,
    ArrowRepeatAllRegular,
    ArrowStepInRegular,
    BranchRegular,
    CalculatorRegular,
    CheckboxCheckedRegular,
    ClipboardTaskRegular,
    CloudFlowRegular,
    CodeRegular,
    CopySelectRegular,
    DatabaseRegular,
    FormRegular,
    HistoryRegular,
    KeyRegular,
    LockClosedRegular,
    NumberSymbolRegular,
    OrganizationRegular,
    PlugConnectedRegular,
    PuzzlePieceRegular,
    ScriptRegular,
} from '@fluentui/react-icons';
import type { FC, SVGProps } from 'react';
import type { LogicKind } from '../../domain/model';
import { KIND_LABEL } from '../theme';

type IconComponent = FC<SVGProps<SVGSVGElement> & { title?: string }>;

const ICONS: Record<LogicKind, IconComponent> = {
    plugin: PlugConnectedRegular,
    customapi: CodeRegular,
    workflow: ArrowRepeatAllRegular,
    action: ArrowStepInRegular,
    flow: CloudFlowRegular,
    businessrule: ClipboardTaskRegular,
    formscript: ScriptRegular,
    pcf: PuzzlePieceRegular,
    formcomponent: FormRegular,
    bpf: BranchRegular,
    duplicaterule: CopySelectRegular,
    cascade: OrganizationRegular,
    key: KeyRegular,
    requiredcolumn: CheckboxCheckedRegular,
    formula: CalculatorRegular,
    rollup: DatabaseRegular,
    calculated: CalculatorRegular,
    autonumber: NumberSymbolRegular,
    fieldsecurity: LockClosedRegular,
    audit: HistoryRegular,
    app: AppsRegular,
};

export function KindIcon({ kind, size = 16 }: { kind: LogicKind; size?: number }) {
    const Icon = ICONS[kind] ?? CodeRegular;
    return <Icon aria-label={KIND_LABEL[kind] ?? kind} title={KIND_LABEL[kind] ?? kind} style={{ width: size, height: size, flex: '0 0 auto' }} />;
}
