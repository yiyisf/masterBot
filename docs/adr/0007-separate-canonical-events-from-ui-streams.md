# Separate canonical execution events from UI streams

The Harness will emit ordered, versioned Run Events as replayable execution facts and separate high-frequency Output Deltas from durable lifecycle records. A UI Presenter will project those records into the chosen UI streaming contract and frontend view models, so neither the Harness nor persistence depends on assistant-ui, Vercel AI SDK UI, AG-UI, SSE, WebSocket, or React types. This replaces the overloaded `ExecutionStep` contract and permits UI libraries and transports to change without rewriting the execution model or historical data.
