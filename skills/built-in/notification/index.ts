import type { SkillContext } from '../../../src/types.js';

/**
 * 发送钉钉通知
 */
export async function send_dingtalk(
    ctx: SkillContext,
    params: {
        webhook: string;
        message: string;
        title?: string;
        type?: 'text' | 'markdown';
    }
): Promise<string> {
    const { webhook, message, title = 'CMaster 通知', type = 'markdown' } = params;
    ctx.logger.info(`[notification] send_dingtalk to webhook`);

    let body: Record<string, unknown>;
    if (type === 'markdown') {
        body = {
            msgtype: 'markdown',
            markdown: { title, text: message },
        };
    } else {
        body = {
            msgtype: 'text',
            text: { content: message },
        };
    }

    const response = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        throw new Error(`钉钉发送失败: HTTP ${response.status}`);
    }

    const result = await response.json() as Record<string, unknown>;
    if (result.errcode !== 0) {
        throw new Error(`钉钉发送失败: ${result.errmsg}`);
    }

    return `钉钉消息发送成功`;
}

/**
 * 发送飞书通知
 */
export async function send_feishu(
    ctx: SkillContext,
    params: {
        webhook: string;
        message: string;
        title?: string;
    }
): Promise<string> {
    const { webhook, message, title = 'CMaster 通知' } = params;
    ctx.logger.info(`[notification] send_feishu`);

    const body = {
        msg_type: 'post',
        content: {
            post: {
                zh_cn: {
                    title,
                    content: [[{ tag: 'text', text: message }]],
                },
            },
        },
    };

    const response = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        throw new Error(`飞书发送失败: HTTP ${response.status}`);
    }

    const result = await response.json() as Record<string, unknown>;
    if (result.code !== 0) {
        throw new Error(`飞书发送失败: ${result.msg}`);
    }

    return `飞书消息发送成功`;
}

/**
 * 发送邮件通知
 */
export async function send_email(
    ctx: SkillContext,
    params: {
        to: string;
        subject: string;
        body: string;
        smtp_host?: string;
        smtp_port?: number;
        smtp_user?: string;
        smtp_pass?: string;
        from?: string;
    }
): Promise<string> {
    ctx.logger.info(`[notification] send_email to ${params.to}`);

    const smtpHost = params.smtp_host || process.env.SMTP_HOST;
    const smtpPort = params.smtp_port || parseInt(process.env.SMTP_PORT || '465', 10);
    const smtpUser = params.smtp_user || process.env.SMTP_USER;
    const smtpPass = params.smtp_pass || process.env.SMTP_PASS;
    const fromAddr = params.from || process.env.SMTP_FROM || smtpUser;

    if (!smtpHost || !smtpUser || !smtpPass) {
        throw new Error('邮件配置不完整，请提供 SMTP_HOST、SMTP_USER、SMTP_PASS 环境变量或参数');
    }

    // Dynamic import nodemailer (may not be installed)
    let nodemailer: typeof import('nodemailer');
    try {
        nodemailer = await import('nodemailer');
    } catch {
        throw new Error('nodemailer 未安装，请运行 npm install nodemailer');
    }

    const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass },
    });

    await transporter.sendMail({
        from: fromAddr,
        to: params.to,
        subject: params.subject,
        html: params.body,
    });

    return `邮件已发送至 ${params.to}`;
}

export default { send_dingtalk, send_feishu, send_email };
