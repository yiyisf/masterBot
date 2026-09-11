import type { RunUiTimelineItemContract } from '@cmaster/contracts';
import { memo } from 'react';
import { ToolActivity } from '../../components/ai-elements/tool-activity';
import type { RunProjection } from '../../lib/run-projection';

const copy = {
  'zh-CN': {
    temporary: '临时响应', generating: '正在生成响应', timeline: '执行记录', older: '加载更早的执行记录',
    unknown: '执行活动已变化，安全视图已重新同步。', tool: 'Tool 活动', technical: '技术详情',
    status: { queued: '排队中', working: '进行中', waiting: '等待处理', completed: '已完成', failed: '失败', cancelled: '已取消' },
    toolStatus: { running: '进行中', succeeded: '已完成', denied: '已拒绝', failed: '失败', confirmation_required: '等待确认', requires_review: '需要复核', unknown: '状态已更新' },
    presentations: {
      run_accepted: 'Run 已接受', run_queued: 'Run 已进入队列', run_started: 'Run 已开始', run_recovered: 'Run 已恢复执行', run_waiting: 'Run 正在等待处理', run_resumed: 'Run 已继续',
      context_prepared: 'Context 已准备', agent_started: '工作已开始', model_selected: '执行配置已选择', tool_running: 'Tool 活动进行中', tool_succeeded: 'Tool 活动已完成', tool_denied: 'Tool 活动已拒绝', tool_failed: 'Tool 活动失败',
      approval_requested: '需要 Employee 处理', approval_resolved: 'Employee 决定已保存', artifact_available: 'Artifact 已可用', fallback_selected: '已切换执行配置', output_restarted: '响应正在重新生成', run_completed: 'Run 已完成', run_failed: 'Run 失败', run_cancelled: 'Run 已取消', activity_updated: '执行活动已更新',
    },
  },
  'en-US': {
    temporary: 'Temporary response', generating: 'Generating response', timeline: 'Activity', older: 'Load older activity',
    unknown: 'Activity changed. The safe view was synchronized again.', tool: 'Tool activity', technical: 'Technical details',
    status: { queued: 'Queued', working: 'Active', waiting: 'Waiting', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled' },
    toolStatus: { running: 'Active', succeeded: 'Completed', denied: 'Denied', failed: 'Failed', confirmation_required: 'Awaiting confirmation', requires_review: 'Review required', unknown: 'Updated' },
    presentations: {
      run_accepted: 'Run accepted', run_queued: 'Run queued', run_started: 'Run started', run_recovered: 'Run execution recovered', run_waiting: 'Run is waiting', run_resumed: 'Run resumed',
      context_prepared: 'Context prepared', agent_started: 'Work started', model_selected: 'Execution configuration selected', tool_running: 'Tool activity in progress', tool_succeeded: 'Tool activity completed', tool_denied: 'Tool activity denied', tool_failed: 'Tool activity failed',
      approval_requested: 'Employee action required', approval_resolved: 'Employee decision saved', artifact_available: 'Artifact available', fallback_selected: 'Execution configuration changed', output_restarted: 'Response generation restarted', run_completed: 'Run completed', run_failed: 'Run failed', run_cancelled: 'Run cancelled', activity_updated: 'Activity updated',
    },
  },
} as const;

type RunActivityLocale = keyof typeof copy;

function TimelineItem({
  item,
  locale,
}: Readonly<{ item: RunUiTimelineItemContract; locale: RunActivityLocale }>) {
  const text = copy[locale];
  if (item.tool) {
    const technical = item.technical ? {
      ...(item.technical.safeId ? { ID: item.technical.safeId } : {}),
      ...(item.technical.durationMs === undefined
        ? {} : { Duration: `${item.technical.durationMs} ms` }),
      ...(item.technical.correlationId
        ? { 'Correlation ID': item.technical.correlationId } : {}),
    } : undefined;
    return <ToolActivity viewModel={{
      title: item.tool.title ?? text.tool,
      capability: item.tool.capability,
      status: text.toolStatus[item.tool.status],
      details: item.tool.details ?? {},
      ...(technical ? { technical, technicalLabel: text.technical } : {}),
    }} />;
  }
  return (
    <article className={`timeline-item timeline-${item.category}`}>
      <p>{text.presentations[item.presentation]}</p>
      {item.artifact ? (
        <p><code>{item.artifact.artifactId}</code> · <code>{item.artifact.artifactVersionId}</code></p>
      ) : null}
      <time dateTime={item.occurredAt}>
        {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })
          .format(new Date(item.occurredAt))}
      </time>
    </article>
  );
}

const RunTimeline = memo(function RunTimeline({
  timeline,
  hasEarlier,
  locale,
  loadOlder,
}: Readonly<{
  timeline: RunProjection['timeline'];
  hasEarlier: boolean;
  locale: RunActivityLocale;
  loadOlder: () => void;
}>) {
  const text = copy[locale];
  return (
    <section aria-labelledby="run-timeline-title">
      <h2 id="run-timeline-title">{text.timeline}</h2>
      {hasEarlier ? (
        <button className="button secondary" type="button" onClick={loadOlder}>
          {text.older}
        </button>
      ) : null}
      <ol className="run-timeline">
        {timeline.map((item) => (
          <li key={item.id}><TimelineItem item={item} locale={locale} /></li>
        ))}
      </ol>
    </section>
  );
});

const RunTechnicalDetails = memo(function RunTechnicalDetails({
  technical,
  locale,
}: Readonly<{
  technical: RunProjection['technical'];
  locale: RunActivityLocale;
}>) {
  const text = copy[locale];
  return (
    <details className="run-technical">
      <summary>{text.technical}</summary>
      <dl>
        <div><dt>Correlation ID</dt><dd>{technical.correlationId}</dd></div>
        {technical.agentRevisionId ? (
          <div><dt>Agent revision ID</dt><dd>{technical.agentRevisionId}</dd></div>
        ) : null}
        {technical.modelDisplayName ? (
          <div><dt>Model</dt><dd>{technical.modelDisplayName}</dd></div>
        ) : null}
        {technical.fallback !== undefined ? (
          <div><dt>Fallback</dt><dd>{String(technical.fallback)}</dd></div>
        ) : null}
        {technical.usage ? (
          <div><dt>Aggregate usage</dt><dd>{technical.usage.totalTokens} tokens</dd></div>
        ) : null}
        {technical.safeErrorCode ? (
          <div><dt>Error code</dt><dd>{technical.safeErrorCode}</dd></div>
        ) : null}
      </dl>
    </details>
  );
});

export function RunActivity({
  projection,
  locale,
  unknownActivity,
  commands,
}: Readonly<{
  projection: RunProjection;
  locale: RunActivityLocale;
  unknownActivity: boolean;
  commands: { readonly loadOlder: () => void };
}>) {
  const text = copy[locale];
  return (
    <>
      <p className="run-status"><strong>{text.status[projection.status]}</strong></p>
      {unknownActivity ? <p className="error" role="alert">{text.unknown}</p> : null}
      {projection.draft ? (
        <section className="assistant-draft" aria-labelledby="assistant-draft-title">
          <h2 id="assistant-draft-title">{text.temporary}</h2>
          <p className="sr-only" role="status">{text.generating}</p>
          <div>{projection.draft.text}</div>
        </section>
      ) : null}
      <RunTimeline timeline={projection.timeline} hasEarlier={projection.hasEarlierTimeline}
        locale={locale} loadOlder={commands.loadOlder} />
      <RunTechnicalDetails technical={projection.technical} locale={locale} />
    </>
  );
}
