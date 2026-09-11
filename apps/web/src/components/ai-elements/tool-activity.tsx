export interface ToolActivityViewModel {
  readonly title: string;
  readonly capability: string;
  readonly status: string;
  readonly details: Readonly<Record<string, string>>;
  readonly technical?: Readonly<Record<string, string>>;
  readonly technicalLabel?: string;
}

/** AI Elements 1.9.0 Tool registry source 的纯展示薄适配，不接触执行协议。 */
export function ToolActivity({ viewModel }: Readonly<{ viewModel: ToolActivityViewModel }>) {
  return (
    <article className="tool-activity">
      <header>
        <strong>{viewModel.title}</strong>
        <span className="status-pill">{viewModel.status}</span>
      </header>
      <p className="tool-capability">{viewModel.capability}</p>
      {Object.keys(viewModel.details).length > 0 ? (
        <dl>
          {Object.entries(viewModel.details).map(([key, value]) => (
            <div key={key}><dt>{key}</dt><dd>{value}</dd></div>
          ))}
        </dl>
      ) : null}
      {viewModel.technical && Object.keys(viewModel.technical).length > 0 ? (
        <details>
          <summary>{viewModel.technicalLabel}</summary>
          <dl>
            {Object.entries(viewModel.technical).map(([key, value]) => (
              <div key={key}><dt>{key}</dt><dd>{value}</dd></div>
            ))}
          </dl>
        </details>
      ) : null}
    </article>
  );
}
