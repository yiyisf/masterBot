import type { SkillContext } from '../../../src/types.js';

interface EmployeeInfo {
    employeeId: string;
    name: string;
    department: string;
    position: string;
    departmentId?: string;
}

interface ApiResponse {
    success: boolean;
    data?: any;
    error?: string;
}

async function makeHrApiRequest(ctx: SkillContext, endpoint: string, params: Record<string, string>): Promise<any> {
    const baseUrl = ctx.config.hrApiBaseUrl || process.env.HR_API_BASE_URL;
    if (!baseUrl) {
        throw new Error('HR API base URL is not configured');
    }
    
    const url = new URL(`${baseUrl}/${endpoint}`);
    Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value);
    });
    
    ctx.logger.info(`[hr-api] Making request to ${url.toString()}`);
    
    const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${ctx.config.hrApiToken || process.env.HR_API_TOKEN}`
        }
    });
    
    if (!response.ok) {
        throw new Error(`HR API request failed with status ${response.status}`);
    }
    
    const result: ApiResponse = await response.json();
    if (!result.success) {
        throw new Error(result.error || 'HR API request failed');
    }
    
    return result.data;
}

export async function get_employee_info(
    ctx: SkillContext,
    params: { employeeId: string }
): Promise<EmployeeInfo> {
    ctx.logger.info(`[hr-api] get_employee_info called for employee ${params.employeeId}`);
    
    if (!params.employeeId) {
        throw new Error('employeeId is required');
    }
    
    const data = await makeHrApiRequest(ctx, 'employees/info', {
        employeeId: params.employeeId
    });
    
    return {
        employeeId: data.employeeId,
        name: data.name,
        department: data.department,
        position: data.position,
        departmentId: data.departmentId
    };
}

export async function get_department_employees(
    ctx: SkillContext,
    params: { departmentId: string }
): Promise<EmployeeInfo[]> {
    ctx.logger.info(`[hr-api] get_department_employees called for department ${params.departmentId}`);
    
    if (!params.departmentId) {
        throw new Error('departmentId is required');
    }
    
    const data = await makeHrApiRequest(ctx, 'departments/employees', {
        departmentId: params.departmentId
    });
    
    return data.map((employee: any) => ({
        employeeId: employee.employeeId,
        name: employee.name,
        department: employee.department,
        position: employee.position
    }));
}

export async function get_direct_supervisor(
    ctx: SkillContext,
    params: { employeeId: string }
): Promise<EmployeeInfo> {
    ctx.logger.info(`[hr-api] get_direct_supervisor called for employee ${params.employeeId}`);
    
    if (!params.employeeId) {
        throw new Error('employeeId is required');
    }
    
    const data = await makeHrApiRequest(ctx, 'employees/supervisor', {
        employeeId: params.employeeId
    });
    
    return {
        employeeId: data.employeeId,
        name: data.name,
        department: data.department,
        position: data.position
    };
}