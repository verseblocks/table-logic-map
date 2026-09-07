/** Raw tab: per-source redacted JSON (collapsible, truncated over 200 KB) + "Save raw sources as fixture". */
import { Accordion, AccordionHeader, AccordionItem, AccordionPanel, Button, Text } from '@fluentui/react-components';
import { SaveRegular } from '@fluentui/react-icons';
import { ALL_SOURCES } from '../../domain/model';
import { useAppStore } from '../store';
import { RAW_MAX_BYTES, SOURCE_LABEL } from '../theme';
import { EmptyState, JsonBlock, PartialSkeleton } from '../components/Primitives';

function sizeOf(value: unknown): string {
    try {
        const n = JSON.stringify(value)?.length ?? 0;
        return n < 1024 ? `${n} B` : `${Math.round(n / 1024)} KB`;
    } catch {
        return '?';
    }
}

export function RawTab() {
    const map = useAppStore((s) => s.map);
    const saveRawFixture = useAppStore((s) => s.saveRawFixture);
    if (!map) return <EmptyState title="No table selected" />;
    const raw = map.raw ?? {};
    const sources = ALL_SOURCES.filter((s) => raw[s] !== undefined);
    return (
        <div>
            <div className="tlm-row" style={{ marginBottom: 8 }}>
                <Text size={200} className="tlm-muted">
                    Raw records as returned by each source, already redacted (no secure configuration, no full flow definitions, no query strings). Includes hidden system steps.
                </Text>
                <span className="tlm-grow" />
                <Button size="small" icon={<SaveRegular />} onClick={() => void saveRawFixture()} disabled={sources.length === 0}>
                    Save raw sources as fixture
                </Button>
            </div>
            {sources.length === 0 ? (
                <EmptyState title="No raw data yet" />
            ) : (
                <Accordion multiple collapsible>
                    {sources.map((s) => (
                        <AccordionItem key={s} value={s}>
                            <AccordionHeader size="small">
                                {SOURCE_LABEL[s]} <span className="tlm-muted" style={{ marginLeft: 6 }}>({s} · {sizeOf(raw[s])})</span>
                            </AccordionHeader>
                            <AccordionPanel>
                                <JsonBlock value={raw[s]} maxBytes={RAW_MAX_BYTES} />
                            </AccordionPanel>
                        </AccordionItem>
                    ))}
                </Accordion>
            )}
            <PartialSkeleton map={map} rows={1} />
        </div>
    );
}
