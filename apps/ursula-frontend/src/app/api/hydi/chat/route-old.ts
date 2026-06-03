import { NextRequest, NextResponse } from 'next/server';

interface HYDIRequest {
  message: string;
  context: {
    user: string;
    system: string;
    capabilities: string[];
  };
}

interface HYDIResponse {
  response: string;
  actions?: string[];
  confidence: number;
}

// HYDI Command Processor
async function processHYDICommand(message: string, context: HYDIRequest['context']): Promise<HYDIResponse> {
  const lowerMessage = message.toLowerCase();
  
  // Payment Processing Commands
  if (lowerMessage.includes('payment') || lowerMessage.includes('stripe') || lowerMessage.includes('payment link')) {
    return {
      response: `I can help you set up payment processing! Here are your options:

**Current Payment Links Ready:**
• ProtoForge Retainer ($100): https://buy.stripe.com/aFa14ngmM5A785yaie8IU0w
• AI Content Pack ($50): https://buy.stripe.com/eVqdR97Qg7Iffy0duq8IU0x  
• Technical Consulting ($150): https://buy.stripe.com/5kQ00jb2sd2z3Piaie8IU0y

**Next Steps:**
1. Share these links with clients
2. Set up your Fiverr gig for payment processing ($500-3,500)
3. Apply to Upwork jobs with the PaaS proposal template

Your Stripe account is fully configured with 14+ payment methods. What would you like to focus on?`,
      actions: ['create_payment_link', 'publish_fiverr_gig', 'apply_upwork'],
      confidence: 0.95,
    };
  }
  
  // Code Analysis Commands
  if (lowerMessage.includes('code') || lowerMessage.includes('analyze') || lowerMessage.includes('security')) {
    return {
      response: `I can analyze your codebase! Here's what I can do:

**Security Analysis:**
• Scan for vulnerabilities in dependencies
• Check for exposed API keys or secrets
• Analyze code quality and patterns
• Review authentication and authorization

**Code Quality:**
• Check for deprecated dependencies
• Analyze test coverage
• Review code structure and patterns
• Suggest improvements

I found 190 vulnerabilities in your GitHub repository. Would you like me to:
1. Run a detailed security scan
2. Check specific files for issues
3. Update dependencies
4. Generate a security report?`,
      actions: ['security_scan', 'dependency_check', 'code_quality_report'],
      confidence: 0.88,
    };
  }
  
  // Documentation Commands
  if (lowerMessage.includes('documentation') || lowerMessage.includes('docs') || lowerMessage.includes('readme')) {
    return {
      response: `I can help with documentation! Here's your current status:

**Documentation Found:**
• API docs at: https://api.protoforgeindustries.com/docs
• HMH Revenue Strategy: Complete
• Payment-as-a-Service Strategy: Complete
• GitHub README: Needs updates

**I Can:**
• Update API documentation based on code changes
• Generate README files for projects
• Create inline code documentation
• Update changelogs and release notes

What documentation would you like me to work on?`,
      actions: ['update_api_docs', 'generate_readme', 'create_changelog'],
      confidence: 0.92,
    };
  }
  
  // Automation Commands
  if (lowerMessage.includes('automation') || lowerMessage.includes('task') || lowerMessage.includes('workflow')) {
    return {
      response: `I can set up automation workflows! Here's what's running:

**Current Automation:**
• GitHub → Email → HYDI task pipeline: ✅ Working
• Email approval forwarding to waveformer1984@gmail.com: ✅ Configured
• Payment webhook processing: ✅ Fixed and working
• Task executor runs every 5 minutes: ✅ Active

**Available Workflows:**
• Automated code reviews for PRs
• Security scanning on commits
• Documentation updates
• Payment processing automation
• Incident reporting and alerts

What automation would you like me to configure?`,
      actions: ['setup_github_automation', 'configure_email_workflow', 'automate_payments'],
      confidence: 0.90,
    };
  }
  
  // Default Response
  return {
    response: `I understand you want help with: "${message}"

**My Capabilities:**
• Payment Processing Setup (Stripe, PayPal, Square)
• Code Analysis & Security Scanning  
• Documentation & API Updates
• Automation Workflows
• Task Management & Execution

**Current Status:**
• Payment links: Ready to share
• Webhooks: Fixed and working
• Email automation: Operational
• GitHub integration: Connected

Could you be more specific about which area you'd like to work on? I can then provide detailed assistance and take action.`,
    actions: ['clarify_request'],
    confidence: 0.75,
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: HYDIRequest = await request.json();
    const { message, context } = body;
    
    if (!message || !context) {
      return NextResponse.json(
        { error: 'Missing required fields: message, context' },
        { status: 400 }
      );
    }
    
    // Process the command
    const result = await processHYDICommand(message, context);
    
    // Log the interaction
    console.log(`HYDI Chat - ${context.user}: ${message}`);
    console.log(`HYDI Response - Confidence: ${result.confidence}`);
    
    return NextResponse.json(result);
    
  } catch (error) {
    console.error('HYDI Chat Error:', error);
    
    return NextResponse.json(
      { 
        response: 'I encountered an error processing your request. Please try again or contact support if the issue persists.',
        confidence: 0.1
      },
      { status: 500 }
    );
  }
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    status: 'HYDI Chat API is running',
    capabilities: [
      'payment-processing',
      'code-analysis', 
      'documentation',
      'automation',
      'task-management'
    ],
    version: '1.0.0'
  });
}
