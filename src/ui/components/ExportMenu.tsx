/** Export split button: primary action = last used format; menu lists formats + the diagram toggle. */
import { Menu, MenuDivider, MenuItem, MenuItemCheckbox, MenuList, MenuPopover, MenuTrigger, SplitButton, Tooltip, type MenuButtonProps } from '@fluentui/react-components';
import { ArrowExportRegular } from '@fluentui/react-icons';
import { useAppStore, type ExportFormat } from '../store';

const BUTTON_LABEL: Record<ExportFormat, string> = {
    markdown: 'Export Markdown',
    json: 'Export JSON',
    html: 'Export HTML',
};

export function ExportMenu({ disabled }: { disabled: boolean }) {
    const exportAs = useAppStore((s) => s.exportAs);
    const last = useAppStore((s) => s.exportLastFormat);
    const includeDiagrams = useAppStore((s) => s.includeDiagrams);
    const setIncludeDiagrams = useAppStore((s) => s.setIncludeDiagrams);
    const label = BUTTON_LABEL[last];
    return (
        <Menu positioning="below-end" checkedValues={{ options: includeDiagrams ? ['diagrams'] : [] }} onCheckedValueChange={(_, data) => setIncludeDiagrams(data.checkedItems.includes('diagrams'))}>
            <MenuTrigger disableButtonEnhancement>
                {(triggerProps: MenuButtonProps) => (
                    <SplitButton size="small" icon={<ArrowExportRegular />} menuButton={triggerProps} primaryActionButton={{ onClick: () => void exportAs(last), 'aria-label': label }} disabled={disabled}>
                        {label}
                    </SplitButton>
                )}
            </MenuTrigger>
            <MenuPopover>
                <MenuList>
                    <MenuItem onClick={() => void exportAs('markdown')}>Markdown (.md)</MenuItem>
                    <MenuItem onClick={() => void exportAs('json')}>JSON (.json)</MenuItem>
                    <MenuItem onClick={() => void exportAs('html')}>HTML (.html)</MenuItem>
                    <MenuDivider />
                    {/* One toggle, two renderings: Mermaid code blocks in Markdown, inline SVG in HTML. */}
                    <Tooltip content="Pipeline diagram per event: Mermaid code blocks in Markdown, inline SVG in HTML. JSON is unaffected." relationship="description" withArrow>
                        <MenuItemCheckbox name="options" value="diagrams">
                            Include diagrams
                        </MenuItemCheckbox>
                    </Tooltip>
                </MenuList>
            </MenuPopover>
        </Menu>
    );
}
