/** Store notices (host missing, connection errors) and per-source failure banners. */
import { Button, MessageBar, MessageBarActions, MessageBarBody, MessageBarTitle } from '@fluentui/react-components';
import { DismissRegular } from '@fluentui/react-icons';
import type { SourceError } from '../../domain/model';
import { useAppStore } from '../store';
import { SOURCE_LABEL, SOURCE_MISSING } from '../theme';

export function sourceErrorText(err: SourceError): { title: string; body: string } {
    const label = SOURCE_LABEL[err.source];
    if (err.kind === 'permission') {
        return { title: `${label}: insufficient privileges`, body: `This map is missing ${SOURCE_MISSING[err.source]}. Ask an administrator for read access (${err.message}).` };
    }
    if (err.kind === 'aborted') return { title: `${label}: cancelled`, body: `This map is missing ${SOURCE_MISSING[err.source]}.` };
    return { title: `${label}: failed`, body: `${err.message} — this map is missing ${SOURCE_MISSING[err.source]}.` };
}

export function Notices() {
    const notices = useAppStore((s) => s.notices);
    const dismissNotice = useAppStore((s) => s.dismissNotice);
    const sourceErrors = useAppStore((s) => s.map?.sourceErrors);
    const dismissed = useAppStore((s) => s.dismissedSourceErrors);
    const dismissSourceError = useAppStore((s) => s.dismissSourceError);
    const runError = useAppStore((s) => (s.run.status === 'error' ? s.run.error : undefined));

    const errors = (sourceErrors ?? []).filter((e) => !dismissed.includes(e.source) && e.kind !== 'aborted');
    if (notices.length === 0 && errors.length === 0 && !runError) return null;

    return (
        <div className="tlm-notices">
            {notices.map((n) => (
                <MessageBar key={n.id} intent={n.kind === 'error' ? 'error' : n.kind === 'warning' ? 'warning' : 'info'}>
                    <MessageBarBody>{n.text}</MessageBarBody>
                    <MessageBarActions containerAction={<Button appearance="transparent" size="small" icon={<DismissRegular />} aria-label="Dismiss" onClick={() => dismissNotice(n.id)} />} />
                </MessageBar>
            ))}
            {runError && (
                <MessageBar intent="error">
                    <MessageBarBody>
                        <MessageBarTitle>Map failed</MessageBarTitle>
                        {runError}
                    </MessageBarBody>
                </MessageBar>
            )}
            {errors.map((e) => {
                const { title, body } = sourceErrorText(e);
                return (
                    <MessageBar key={e.source} intent={e.kind === 'permission' ? 'warning' : 'error'}>
                        <MessageBarBody>
                            <MessageBarTitle>{title}</MessageBarTitle>
                            {body}
                        </MessageBarBody>
                        <MessageBarActions containerAction={<Button appearance="transparent" size="small" icon={<DismissRegular />} aria-label="Dismiss" onClick={() => dismissSourceError(e.source)} />} />
                    </MessageBar>
                );
            })}
        </div>
    );
}
