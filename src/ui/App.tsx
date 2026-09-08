/**
 * App shell: FluentProvider (theme from the store) → Header → notices → progress → tabs →
 * main area + detail pane. Every tab reads the store directly; App only routes.
 */
import { FluentProvider, Tab, TabList, webDarkTheme, webLightTheme, type SelectTabData } from '@fluentui/react-components';
import { useEffect } from 'react';
import { BrandFooter } from './components/Brand';
import { DetailPane } from './components/DetailPane';
import { Header } from './components/Header';
import { Notices } from './components/Notices';
import { SourceProgress } from './components/SourceProgress';
import { useVisibleMap } from './hooks/useVisibleMap';
import { useAppStore, type TabId } from './store';
import { ColumnsTab } from './tabs/ColumnsTab';
import { DataRulesTab } from './tabs/DataRulesTab';
import { EverythingTab } from './tabs/EverythingTab';
import { FormsTab } from './tabs/FormsTab';
import { PipelineTab } from './tabs/PipelineTab';
import { RawTab } from './tabs/RawTab';
import { TouchedByTab } from './tabs/TouchedByTab';

const TABS: { id: TabId; label: string }[] = [
    { id: 'pipeline', label: 'Pipeline' },
    { id: 'forms', label: 'Forms' },
    { id: 'columns', label: 'Columns' },
    { id: 'datarules', label: 'Data rules' },
    { id: 'touchedby', label: 'Touched by' },
    { id: 'everything', label: 'Everything' },
    { id: 'raw', label: 'Raw' },
];

function isTabId(v: unknown): v is TabId {
    return typeof v === 'string' && TABS.some((t) => t.id === v);
}

function TabBody({ tab }: { tab: TabId }) {
    switch (tab) {
        case 'forms':
            return <FormsTab />;
        case 'columns':
            return <ColumnsTab />;
        case 'datarules':
            return <DataRulesTab />;
        case 'touchedby':
            return <TouchedByTab />;
        case 'everything':
            return <EverythingTab />;
        case 'raw':
            return <RawTab />;
        default:
            return <PipelineTab />;
    }
}

function TabBar() {
    const activeTab = useAppStore((s) => s.activeTab);
    const setTab = useAppStore((s) => s.setTab);
    const map = useVisibleMap();
    const counts: Partial<Record<TabId, number>> = map
        ? {
              forms: map.forms.length,
              columns: Object.keys(map.columns).length,
              touchedby: map.externalTouchers.length,
              everything: map.items.length,
          }
        : {};
    return (
        <TabList className="tlm-tabs" size="small" selectedValue={activeTab} onTabSelect={(_, data: SelectTabData) => isTabId(data.value) && setTab(data.value)}>
            {TABS.map((t) => (
                <Tab key={t.id} value={t.id}>
                    {t.label}
                    {counts[t.id] !== undefined ? <span className="tlm-muted"> ({counts[t.id]})</span> : null}
                </Tab>
            ))}
        </TabList>
    );
}

export default function App() {
    const theme = useAppStore((s) => s.theme);
    const init = useAppStore((s) => s.init);
    const activeTab = useAppStore((s) => s.activeTab);
    useEffect(() => {
        void init();
    }, [init]);

    return (
        <FluentProvider theme={theme === 'dark' ? webDarkTheme : webLightTheme} style={{ height: '100%' }}>
            <div className="tlm-app">
                <Header />
                <Notices />
                <SourceProgress />
                <TabBar />
                <div className="tlm-body">
                    <main className="tlm-main" role="tabpanel" aria-label={TABS.find((t) => t.id === activeTab)?.label}>
                        <TabBody tab={activeTab} />
                    </main>
                    <DetailPane />
                </div>
                <BrandFooter />
            </div>
        </FluentProvider>
    );
}
