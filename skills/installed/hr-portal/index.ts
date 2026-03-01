import type { SkillContext } from '../../../src/types.js';

// ─────────────────────────────────────────────
// Mock data (used when HR_API_URL is not set)
// ─────────────────────────────────────────────

const MOCK_EMPLOYEES = [
    { id: 'EMP001', name: '张伟', department: '技术研发部', title: '高级工程师', email: 'zhang.wei@company.com', manager: 'EMP010', phone: '138****0001' },
    { id: 'EMP002', name: '李娜', department: '产品部', title: '产品经理', email: 'li.na@company.com', manager: 'EMP011', phone: '139****0002' },
    { id: 'EMP003', name: '王芳', department: '人力资源部', title: 'HR 专员', email: 'wang.fang@company.com', manager: 'EMP012', phone: '137****0003' },
    { id: 'EMP004', name: '刘洋', department: '技术研发部', title: '前端工程师', email: 'liu.yang@company.com', manager: 'EMP001', phone: '136****0004' },
    { id: 'EMP005', name: '陈敏', department: '市场部', title: '市场专员', email: 'chen.min@company.com', manager: 'EMP013', phone: '135****0005' },
    { id: 'EMP006', name: '赵磊', department: '技术研发部', title: '后端工程师', email: 'zhao.lei@company.com', manager: 'EMP001', phone: '134****0006' },
    { id: 'EMP007', name: '孙婷', department: '财务部', title: '财务分析师', email: 'sun.ting@company.com', manager: 'EMP014', phone: '133****0007' },
    { id: 'EMP008', name: '周鑫', department: '运维部', title: 'DevOps 工程师', email: 'zhou.xin@company.com', manager: 'EMP015', phone: '132****0008' },
    { id: 'EMP009', name: '吴静', department: '产品部', title: 'UI 设计师', email: 'wu.jing@company.com', manager: 'EMP011', phone: '131****0009' },
    { id: 'EMP010', name: '郑建国', department: '技术研发部', title: '技术总监', email: 'zheng.jianguo@company.com', manager: 'EMP100', phone: '130****0010' },
    { id: 'EMP011', name: '马晓燕', department: '产品部', title: '产品总监', email: 'ma.xiaoyan@company.com', manager: 'EMP100', phone: '180****0011' },
    { id: 'EMP012', name: '黄丽华', department: '人力资源部', title: 'HR 总监', email: 'huang.lihua@company.com', manager: 'EMP100', phone: '181****0012' },
    { id: 'EMP013', name: '朱强', department: '市场部', title: '市场总监', email: 'zhu.qiang@company.com', manager: 'EMP100', phone: '182****0013' },
    { id: 'EMP014', name: '谢美玲', department: '财务部', title: '财务总监', email: 'xie.meiling@company.com', manager: 'EMP100', phone: '183****0014' },
    { id: 'EMP015', name: '徐志远', department: '运维部', title: '运维总监', email: 'xu.zhiyuan@company.com', manager: 'EMP100', phone: '184****0015' },
    { id: 'EMP100', name: 'CEO', department: '管理层', title: '首席执行官', email: 'ceo@company.com', manager: '', phone: '185****0100' },
];

const MOCK_LEAVE_BALANCE: Record<string, Record<string, { total: number; used: number }>> = {
    EMP001: { annual: { total: 15, used: 5 }, sick: { total: 10, used: 2 }, comp: { total: 3, used: 1 }, marriage: { total: 0, used: 0 } },
    EMP002: { annual: { total: 15, used: 8 }, sick: { total: 10, used: 0 }, comp: { total: 5, used: 3 }, marriage: { total: 0, used: 0 } },
    EMP003: { annual: { total: 10, used: 2 }, sick: { total: 10, used: 1 }, comp: { total: 1, used: 0 }, marriage: { total: 0, used: 0 } },
    EMP004: { annual: { total: 10, used: 3 }, sick: { total: 10, used: 0 }, comp: { total: 2, used: 2 }, marriage: { total: 0, used: 0 } },
};

const MOCK_ORG: Record<string, { head: string; headTitle: string; count: number; children: string[] }> = {
    '公司': { head: 'CEO', headTitle: '首席执行官', count: 16, children: ['技术研发部', '产品部', '人力资源部', '市场部', '财务部', '运维部'] },
    '技术研发部': { head: '郑建国', headTitle: '技术总监', count: 4, children: ['前端组', '后端组'] },
    '产品部': { head: '马晓燕', headTitle: '产品总监', count: 3, children: ['产品规划组', '设计组'] },
    '人力资源部': { head: '黄丽华', headTitle: 'HR 总监', count: 2, children: ['招聘组', '员工关系组'] },
    '市场部': { head: '朱强', headTitle: '市场总监', count: 2, children: ['品牌组', '增长组'] },
    '财务部': { head: '谢美玲', headTitle: '财务总监', count: 2, children: ['会计组', '预算组'] },
    '运维部': { head: '徐志远', headTitle: '运维总监', count: 2, children: ['基础设施组', '安全组'] },
};

const LEAVE_TYPE_LABELS: Record<string, string> = {
    annual: '年假', sick: '病假', comp: '调休', personal: '事假', other: '其他',
};

const HR_POLICIES: Record<string, Array<{ title: string; content: string }>> = {
    leave: [
        { title: '年假政策', content: '工作满1年不足10年享受5天年假；满10年不足20年享受10天；满20年以上享受15天。年假须在当年12月31日前使用，过期不予补偿。' },
        { title: '病假政策', content: '每年享有10天带薪病假。超过10天的病假需提供医院证明，超出部分按基本工资60%发放。' },
        { title: '调休政策', content: '加班产生的调休在6个月内有效，申请须提前1天提交并经直属上级审批。' },
        { title: '婚假政策', content: '依法登记结婚的员工享有3天婚假；晚婚（男25周岁、女23周岁以上）额外享有7天晚婚假。' },
        { title: '产假政策', content: '女性员工依法享有98天产假（含产前15天）；配偶享有15天陪产假。' },
        { title: '丧假政策', content: '直系亲属（父母、配偶、子女）离世，享有3天丧假；祖父母、外祖父母离世享有1天丧假。' },
    ],
    attendance: [
        { title: '工作时间', content: '标准工作时间为周一至周五 9:00-18:00，午休 12:00-13:00。弹性工作时间为 8:00-10:00 至 17:00-19:00，需满足每日8小时。' },
        { title: '打卡规定', content: '员工须使用企业微信或考勤机上下班打卡。迟到超过30分钟计半日事假；早退超过30分钟计半日事假；一个月累计迟到3次扣发当月全勤奖。' },
        { title: '远程办公', content: '经部门总监审批，员工每周可申请不超过2天远程办公。远程办公期间需在线响应，参加所有指定会议。' },
        { title: '加班规定', content: '加班须提前申请或事后72小时内补录。工作日加班优先以调休补偿；法定节假日加班支付3倍工资。每月加班上限不超过36小时（依法律规定）。' },
    ],
    benefits: [
        { title: '社保公积金', content: '公司依法为员工缴纳五险一金（养老险、医疗险、失业险、工伤险、生育险、住房公积金）。公积金缴纳比例：员工12%，公司12%。' },
        { title: '商业补充医疗险', content: '公司为全体员工及其配偶、子女购买商业补充医疗保险，覆盖门诊、住院及重大疾病，保额50万元/年。' },
        { title: '餐饮补贴', content: '每月发放餐饮补贴500元，以餐饮消费券形式发放（可在合作餐厅使用）。' },
        { title: '交通补贴', content: '每月发放交通补贴300元，随工资发放。' },
        { title: '年度体检', content: '每年为员工安排一次全面体检（价值不低于1200元），结果由员工本人保存，HR不获取详情。' },
        { title: '学习发展', content: '每年提供3000元培训预算，可用于专业课程、考证、技术书籍采购，须提前申请经批准后报销。' },
    ],
    performance: [
        { title: '考核周期', content: '绩效考核分为季度考核（占比40%）和年度考核（占比60%）。季度结果影响季度奖金，年度结果影响年终奖和薪资调整。' },
        { title: '绩效等级', content: 'S（优秀，前10%）、A（良好，前30%）、B（达标，约50%）、C（待改进，约10%），S/A员工优先晋升。' },
        { title: '360度评估', content: '年度考核引入360度评估，包含直属上级评分（60%）、同级互评（20%）、跨部门协作评分（20%）。' },
        { title: '绩效改进计划', content: '连续两个季度绩效为C的员工进入PIP（绩效改进计划），PIP期间薪资不调整，PIP结束后重新评估。' },
    ],
    onboarding: [
        { title: '入职材料', content: '入职须携带：身份证原件及复印件、学历证书、上一家公司离职证明、1寸照片4张、银行卡信息（用于工资发放）。' },
        { title: '试用期', content: '所有新员工须经历3个月试用期（特殊岗位可延长至6个月）。试用期工资为转正工资的80%，通过考核后转正补发差额。' },
        { title: '入职培训', content: '入职后前两周参加公司新人培训，内容包括：企业文化、制度规范、安全合规、技术基础设施培训。' },
        { title: 'Buddy计划', content: '每位新员工分配一名工作Buddy（经验丰富的同部门员工），协助度过前3个月的适应期。' },
    ],
    offboarding: [
        { title: '离职申请', content: '员工离职须提前至少30天（管理层60天）以书面形式提出申请，经HR确认后生效。' },
        { title: '工作交接', content: '离职员工须在最后工作日前完成所有工作交接，包括：代码/文档移交、账号权限回收、公司资产归还。' },
        { title: '离职结算', content: '离职当月薪资按实际工作天数结算，在离职日后30个工作日内打款。未使用的年假按日工资折算补偿；调休不补偿。' },
        { title: '竞业限制', content: '核心技术岗位（P7及以上）、管理岗（M3及以上）离职后须遵守12个月竞业限制，公司支付竞业补偿金（每月不低于离职前月均工资的30%）。' },
    ],
};

// ─────────────────────────────────────────────
// Helper: call real HR API or return mock
// ─────────────────────────────────────────────

async function hrApiCall(
    ctx: SkillContext,
    path: string,
    options?: { method?: string; body?: unknown }
): Promise<unknown | null> {
    const apiUrl = process.env.HR_API_URL;
    const apiKey = process.env.HR_API_KEY;

    if (!apiUrl) return null; // no real API configured, caller should use mock

    const url = `${apiUrl.replace(/\/$/, '')}${path}`;
    ctx.logger.info(`HR API ${options?.method ?? 'GET'} ${url}`);

    const res = await fetch(url, {
        method: options?.method ?? 'GET',
        headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    if (!res.ok) {
        throw new Error(`HR API error: ${res.status} ${await res.text()}`);
    }
    return res.json();
}

// ─────────────────────────────────────────────
// Skill actions
// ─────────────────────────────────────────────

/**
 * 搜索员工信息
 */
export async function search_employee(
    ctx: SkillContext,
    params: { query: string; department?: string; limit?: number }
): Promise<unknown> {
    const { query, department, limit = 10 } = params;

    // Try real API first
    const apiResult = await hrApiCall(ctx, `/api/employees?q=${encodeURIComponent(query)}&department=${encodeURIComponent(department ?? '')}&limit=${limit}`);
    if (apiResult) return apiResult;

    // Fall back to mock
    const q = query.toLowerCase();
    let results = MOCK_EMPLOYEES.filter(
        (e) =>
            e.id.toLowerCase().includes(q) ||
            e.name.includes(query) ||
            e.department.includes(query) ||
            e.email.toLowerCase().includes(q) ||
            e.title.includes(query)
    );

    if (department) {
        results = results.filter((e) => e.department.includes(department));
    }

    results = results.slice(0, limit);

    if (results.length === 0) {
        return { found: 0, employees: [], message: `未找到与 "${query}" 匹配的员工。` };
    }

    return {
        found: results.length,
        employees: results.map((e) => ({
            id: e.id,
            name: e.name,
            department: e.department,
            title: e.title,
            email: e.email,
            phone: e.phone,
            manager: MOCK_EMPLOYEES.find((m) => m.id === e.manager)?.name ?? e.manager,
        })),
        note: process.env.HR_API_URL ? '' : '⚠️ 当前为演示数据，生产环境请配置 HR_API_URL。',
    };
}

/**
 * 查询假期余额
 */
export async function get_leave_balance(
    ctx: SkillContext,
    params: { employee_id: string; year?: number }
): Promise<unknown> {
    const { employee_id, year = new Date().getFullYear() } = params;

    const apiResult = await hrApiCall(ctx, `/api/employees/${employee_id}/leave-balance?year=${year}`);
    if (apiResult) return apiResult;

    const employee = MOCK_EMPLOYEES.find((e) => e.id === employee_id);
    if (!employee) {
        return { error: `未找到工号为 ${employee_id} 的员工。` };
    }

    const balance = MOCK_LEAVE_BALANCE[employee_id] ?? {
        annual: { total: 5, used: 0 },
        sick: { total: 10, used: 0 },
        comp: { total: 0, used: 0 },
    };

    const formatted = Object.entries(balance).map(([type, data]) => ({
        type: LEAVE_TYPE_LABELS[type] ?? type,
        total: data.total,
        used: data.used,
        remaining: data.total - data.used,
    }));

    return {
        employee_id,
        employee_name: employee.name,
        year,
        leave_balance: formatted,
        note: process.env.HR_API_URL ? '' : '⚠️ 当前为演示数据。',
    };
}

/**
 * 提交请假申请
 */
export async function submit_leave_request(
    ctx: SkillContext,
    params: {
        employee_id: string;
        leave_type: 'annual' | 'sick' | 'comp' | 'personal' | 'other';
        start_date: string;
        end_date: string;
        reason?: string;
    }
): Promise<unknown> {
    const { employee_id, leave_type, start_date, end_date, reason } = params;

    // Validate dates
    const start = new Date(start_date);
    const end = new Date(end_date);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return { error: '日期格式无效，请使用 YYYY-MM-DD 格式。' };
    }
    if (end < start) {
        return { error: '结束日期不能早于开始日期。' };
    }

    const days = Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1;

    const apiResult = await hrApiCall(ctx, '/api/leave-requests', {
        method: 'POST',
        body: { employee_id, leave_type, start_date, end_date, reason, days },
    });
    if (apiResult) return apiResult;

    // Mock: check balance and approve
    const employee = MOCK_EMPLOYEES.find((e) => e.id === employee_id);
    if (!employee) {
        return { error: `未找到工号为 ${employee_id} 的员工。` };
    }

    const balance = MOCK_LEAVE_BALANCE[employee_id];
    const remaining = balance?.[leave_type]
        ? balance[leave_type].total - balance[leave_type].used
        : 99; // 无限制类型

    if (['annual', 'sick', 'comp'].includes(leave_type) && days > remaining) {
        return {
            success: false,
            error: `假期余额不足。${LEAVE_TYPE_LABELS[leave_type]}剩余 ${remaining} 天，申请 ${days} 天，请核实。`,
        };
    }

    const requestId = `LR${Date.now().toString().slice(-8)}`;
    const manager = MOCK_EMPLOYEES.find((m) => m.id === employee.manager);

    return {
        success: true,
        request_id: requestId,
        status: '待审批',
        employee_name: employee.name,
        leave_type: LEAVE_TYPE_LABELS[leave_type] ?? leave_type,
        start_date,
        end_date,
        days,
        reason: reason ?? '（未填写）',
        approver: manager?.name ?? '直属上级',
        message: `请假申请已提交，单号 ${requestId}，等待 ${manager?.name ?? '直属上级'} 审批。`,
        note: process.env.HR_API_URL ? '' : '⚠️ 当前为演示模式，申请不会真实提交。',
    };
}

/**
 * 查询组织架构
 */
export async function get_org_chart(
    ctx: SkillContext,
    params: { department?: string; depth?: number }
): Promise<unknown> {
    const { department = '公司', depth = 2 } = params;

    const apiResult = await hrApiCall(ctx, `/api/org-chart?department=${encodeURIComponent(department)}&depth=${depth}`);
    if (apiResult) return apiResult;

    function buildTree(dept: string, currentDepth: number): unknown {
        const info = MOCK_ORG[dept];
        if (!info) return { name: dept, head: '—', count: 0, children: [] };

        const node: Record<string, unknown> = {
            name: dept,
            head: info.head,
            head_title: info.headTitle,
            total_count: info.count,
        };

        if (currentDepth > 0 && info.children.length > 0) {
            node.children = info.children.map((child) => buildTree(child, currentDepth - 1));
        } else if (info.children.length > 0) {
            node.sub_departments = info.children;
        }

        return node;
    }

    const tree = buildTree(department, depth);

    return {
        org_chart: tree,
        note: process.env.HR_API_URL ? '' : '⚠️ 当前为演示数据。',
    };
}

/**
 * 查询薪资摘要（脱敏）
 */
export async function get_payroll_summary(
    ctx: SkillContext,
    params: { employee_id: string; month?: string }
): Promise<unknown> {
    const { employee_id } = params;
    const month = params.month ?? (() => {
        const d = new Date();
        d.setMonth(d.getMonth() - 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    })();

    const apiResult = await hrApiCall(ctx, `/api/employees/${employee_id}/payroll?month=${month}`);
    if (apiResult) return apiResult;

    const employee = MOCK_EMPLOYEES.find((e) => e.id === employee_id);
    if (!employee) {
        return { error: `未找到工号为 ${employee_id} 的员工。` };
    }

    // Return ratio-based summary without revealing exact amounts
    return {
        employee_id,
        employee_name: employee.name,
        month,
        summary: {
            structure: [
                { item: '基本工资', ratio: '65%', description: '固定薪资部分' },
                { item: '绩效奖金', ratio: '20%', description: '基于季度绩效评定' },
                { item: '餐补 + 交通补贴', ratio: '5%', description: '固定福利补贴' },
                { item: '加班补偿', ratio: '3%', description: '当月加班合规补偿' },
                { item: '其他补贴', ratio: '7%', description: '岗位津贴等' },
            ],
            deductions: [
                { item: '个人社保', ratio: '8%（养老）+ 2%（医疗）+ 0.5%（失业）' },
                { item: '住房公积金', ratio: '12%' },
                { item: '个人所得税', description: '按应纳税额扣除' },
            ],
        },
        note: '出于隐私保护，薪资摘要仅展示构成比例，不显示具体金额。如需查询具体金额，请联系 HR 专员。',
        disclaimer: process.env.HR_API_URL ? '' : '⚠️ 当前为演示数据。',
    };
}

/**
 * 查询人事制度与政策
 */
export async function list_hr_policies(
    ctx: SkillContext,
    params: { category?: string; keyword?: string }
): Promise<unknown> {
    const { category, keyword } = params;

    const apiResult = await hrApiCall(ctx, `/api/policies?category=${encodeURIComponent(category ?? '')}&keyword=${encodeURIComponent(keyword ?? '')}`);
    if (apiResult) return apiResult;

    const validCategories = Object.keys(HR_POLICIES);
    const categoryLabels: Record<string, string> = {
        leave: '假期制度', attendance: '考勤管理', benefits: '员工福利',
        performance: '绩效管理', onboarding: '入职流程', offboarding: '离职流程',
    };

    let results: { category: string; title: string; content: string }[] = [];

    if (category && HR_POLICIES[category]) {
        results = HR_POLICIES[category].map((p) => ({ category: categoryLabels[category] ?? category, ...p }));
    } else if (!category) {
        // Return overview across all categories
        results = validCategories.flatMap((cat) =>
            HR_POLICIES[cat].map((p) => ({ category: categoryLabels[cat] ?? cat, ...p }))
        );
    } else {
        return {
            error: `未知的政策分类 "${category}"，可用分类：${validCategories.join(', ')}`,
        };
    }

    // Apply keyword filter
    if (keyword) {
        const kw = keyword.toLowerCase();
        results = results.filter(
            (r) => r.title.includes(keyword) || r.content.toLowerCase().includes(kw)
        );
    }

    return {
        total: results.length,
        policies: results,
        available_categories: validCategories.map((c) => ({
            id: c, label: categoryLabels[c] ?? c,
        })),
        note: process.env.HR_API_URL ? '' : '⚠️ 当前为演示数据，请以公司正式制度文件为准。',
    };
}
