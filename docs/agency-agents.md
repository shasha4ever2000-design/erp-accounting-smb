# Agency agents

68 specialist subagents vendored into `.claude/agents/` from
[itallstartedwithaidea/agency-agents](https://github.com/itallstartedwithaidea/agency-agents) at commit `66f20e0`.

They load automatically in any Claude Code session opened on this repository —
CLI, desktop or web — with no per-machine install step. Ask for one by title
("use the Frontend Developer agent") or by id.

## Refreshing

```bash
node scripts/sync-agency-agents.mjs          # pull the latest upstream roster
node scripts/sync-agency-agents.mjs --check  # verify the vendored copy is current
```

Edits made directly in `.claude/agents/` are overwritten by a sync; change the
upstream agent (or the conversion in `scripts/sync-agency-agents.mjs`) instead.

## Roster

### design

| Agent | Id | Focus |
| --- | --- | --- |
| Brand Guardian | `design-brand-guardian` | Expert brand strategist and guardian specializing in brand identity development, consistency maintenance, and strategic brand positioning |
| Image Prompt Engineer | `design-image-prompt-engineer` | Expert photography prompt engineer specializing in crafting detailed, evocative prompts for AI image generation. Masters the art of translating visual concepts into precise language that produces stunning, professional-quality photography through generative AI tools. |
| Inclusive Visuals Specialist | `design-inclusive-visuals-specialist` | Representation expert who defeats systemic AI biases to generate culturally accurate, affirming, and non-stereotypical images and video. |
| UI Designer | `design-ui-designer` | Expert UI designer specializing in visual design systems, component libraries, and pixel-perfect interface creation. Creates beautiful, consistent, accessible user interfaces that enhance UX and reflect brand identity |
| UX Architect | `design-ux-architect` | Technical architecture and UX specialist who provides developers with solid foundations, CSS systems, and clear implementation guidance |
| UX Researcher | `design-ux-researcher` | Expert user experience researcher specializing in user behavior analysis, usability testing, and data-driven design insights. Provides actionable research findings that improve product usability and user satisfaction |
| Visual Storyteller | `design-visual-storyteller` | Expert visual communication specialist focused on creating compelling visual narratives, multimedia content, and brand storytelling through design. Specializes in transforming complex information into engaging visual stories that connect with audiences and drive emotional engagement. |
| Whimsy Injector | `design-whimsy-injector` | Expert creative specialist focused on adding personality, delight, and playful elements to brand experiences. Creates memorable, joyful interactions that differentiate brands through unexpected moments of whimsy |

### engineering

| Agent | Id | Focus |
| --- | --- | --- |
| AI Engineer | `engineering-ai-engineer` | Expert AI/ML engineer specializing in machine learning model development, deployment, and integration into production systems. Focused on building intelligent features, data pipelines, and AI-powered applications with emphasis on practical, scalable solutions. |
| Autonomous Optimization Architect | `engineering-autonomous-optimization-architect` | Intelligent system governor that continuously shadow-tests APIs for performance while enforcing strict financial and security guardrails against runaway costs. |
| Backend Architect | `engineering-backend-architect` | Senior backend architect specializing in scalable system design, database architecture, API development, and cloud infrastructure. Builds robust, secure, performant server-side applications and microservices |
| Data Engineer | `engineering-data-engineer` | Expert data engineer specializing in building reliable data pipelines, lakehouse architectures, and scalable data infrastructure. Masters ETL/ELT, Apache Spark, dbt, streaming systems, and cloud data platforms to turn raw data into trusted, analytics-ready assets. |
| DevOps Automator | `engineering-devops-automator` | Expert DevOps engineer specializing in infrastructure automation, CI/CD pipeline development, and cloud operations |
| Frontend Developer | `engineering-frontend-developer` | Expert frontend developer specializing in modern web technologies, React/Vue/Angular frameworks, UI implementation, and performance optimization |
| Mobile App Builder | `engineering-mobile-app-builder` | Specialized mobile application developer with expertise in native iOS/Android development and cross-platform frameworks |
| Rapid Prototyper | `engineering-rapid-prototyper` | Specialized in ultra-fast proof-of-concept development and MVP creation using efficient tools and frameworks |
| Security Engineer | `engineering-security-engineer` | Expert application security engineer specializing in threat modeling, vulnerability assessment, secure code review, and security architecture design for modern web and cloud-native applications. |
| Senior Developer | `engineering-senior-developer` | Premium implementation specialist - Masters Laravel/Livewire/FluxUI, advanced CSS, Three.js integration |
| Technical Writer | `engineering-technical-writer` | Expert technical writer specializing in developer documentation, API references, README files, and tutorials. Transforms complex engineering concepts into clear, accurate, and engaging docs that developers actually read and use. |

### marketing

| Agent | Id | Focus |
| --- | --- | --- |
| App Store Optimizer | `marketing-app-store-optimizer` | Expert app store marketing specialist focused on App Store Optimization (ASO), conversion rate optimization, and app discoverability |
| Content Creator | `marketing-content-creator` | Expert content strategist and creator for multi-platform campaigns. Develops editorial calendars, creates compelling copy, manages brand storytelling, and optimizes content for engagement across all digital channels. |
| Growth Hacker | `marketing-growth-hacker` | Expert growth strategist specializing in rapid user acquisition through data-driven experimentation. Develops viral loops, optimizes conversion funnels, and finds scalable growth channels for exponential business growth. |
| Instagram Curator | `marketing-instagram-curator` | Expert Instagram marketing specialist focused on visual storytelling, community building, and multi-format content optimization. Masters aesthetic development and drives meaningful engagement. |
| Reddit Community Builder | `marketing-reddit-community-builder` | Expert Reddit marketing specialist focused on authentic community engagement, value-driven content creation, and long-term relationship building. Masters Reddit culture navigation. |
| Social Media Strategist | `marketing-social-media-strategist` | Expert social media strategist for LinkedIn, Twitter, and professional platforms. Creates cross-platform campaigns, builds communities, manages real-time engagement, and develops thought leadership strategies. |
| TikTok Strategist | `marketing-tiktok-strategist` | Expert TikTok marketing specialist focused on viral content creation, algorithm optimization, and community building. Masters TikTok's unique culture and features for brand growth. |
| Twitter Engager | `marketing-twitter-engager` | Expert Twitter marketing specialist focused on real-time engagement, thought leadership building, and community-driven growth. Builds brand authority through authentic conversation participation and viral thread creation. |
| WeChat Official Account Manager | `marketing-wechat-official-account` | Expert WeChat Official Account (OA) strategist specializing in content marketing, subscriber engagement, and conversion optimization. Masters multi-format content and builds loyal communities through consistent value delivery. |
| Xiaohongshu Specialist | `marketing-xiaohongshu-specialist` | Expert Xiaohongshu marketing specialist focused on lifestyle content, trend-driven strategies, and authentic community engagement. Masters micro-content creation and drives viral growth through aesthetic storytelling. |
| Zhihu Strategist | `marketing-zhihu-strategist` | Expert Zhihu marketing specialist focused on thought leadership, community credibility, and knowledge-driven engagement. Masters question-answering strategy and builds brand authority through authentic expertise sharing. |

### product

| Agent | Id | Focus |
| --- | --- | --- |
| Behavioral Nudge Engine | `product-behavioral-nudge-engine` | Behavioral psychology specialist that adapts software interaction cadences and styles to maximize user motivation and success. |
| Feedback Synthesizer | `product-feedback-synthesizer` | Expert in collecting, analyzing, and synthesizing user feedback from multiple channels to extract actionable product insights. Transforms qualitative feedback into quantitative priorities and strategic recommendations. |
| Sprint Prioritizer | `product-sprint-prioritizer` | Expert product manager specializing in agile sprint planning, feature prioritization, and resource allocation. Focused on maximizing team velocity and business value delivery through data-driven prioritization frameworks. |
| Trend Researcher | `product-trend-researcher` | Expert market intelligence analyst specializing in identifying emerging trends, competitive analysis, and opportunity assessment. Focused on providing actionable insights that drive product strategy and innovation decisions. |

### project-management

| Agent | Id | Focus |
| --- | --- | --- |
| Experiment Tracker | `project-management-experiment-tracker` | Expert project manager specializing in experiment design, execution tracking, and data-driven decision making. Focused on managing A/B tests, feature experiments, and hypothesis validation through systematic experimentation and rigorous analysis. |
| Project Shepherd | `project-management-project-shepherd` | Expert project manager specializing in cross-functional project coordination, timeline management, and stakeholder alignment. Focused on shepherding projects from conception to completion while managing resources, risks, and communications across multiple teams and departments. |
| Studio Operations | `project-management-studio-operations` | Expert operations manager specializing in day-to-day studio efficiency, process optimization, and resource coordination. Focused on ensuring smooth operations, maintaining productivity standards, and supporting all teams with the tools and processes needed for success. |
| Studio Producer | `project-management-studio-producer` | Senior strategic leader specializing in high-level creative and technical project orchestration, resource allocation, and multi-project portfolio management. Focused on aligning creative vision with business objectives while managing complex cross-functional initiatives and ensuring optimal studio operations. |
| Senior Project Manager | `project-manager-senior` | Converts specs to tasks and remembers previous projects. Focused on realistic scope, no background processes, exact spec requirements |

### testing

| Agent | Id | Focus |
| --- | --- | --- |
| Accessibility Auditor | `testing-accessibility-auditor` | Expert accessibility specialist who audits interfaces against WCAG standards, tests with assistive technologies, and ensures inclusive design. Defaults to finding barriers — if it's not tested with a screen reader, it's not accessible. |
| API Tester | `testing-api-tester` | Expert API testing specialist focused on comprehensive API validation, performance testing, and quality assurance across all systems and third-party integrations |
| Evidence Collector | `testing-evidence-collector` | Screenshot-obsessed, fantasy-allergic QA specialist - Default to finding 3-5 issues, requires visual proof for everything |
| Performance Benchmarker | `testing-performance-benchmarker` | Expert performance testing and optimization specialist focused on measuring, analyzing, and improving system performance across all applications and infrastructure |
| Reality Checker | `testing-reality-checker` | Stops fantasy approvals, evidence-based certification - Default to "NEEDS WORK", requires overwhelming proof for production readiness |
| Test Results Analyzer | `testing-test-results-analyzer` | Expert test analysis specialist focused on comprehensive test result evaluation, quality metrics analysis, and actionable insight generation from testing activities |
| Tool Evaluator | `testing-tool-evaluator` | Expert technology assessment specialist focused on evaluating, testing, and recommending tools, software, and platforms for business use and productivity optimization |
| Workflow Optimizer | `testing-workflow-optimizer` | Expert process improvement specialist focused on analyzing, optimizing, and automating workflows across all business functions for maximum productivity and efficiency |

### support

| Agent | Id | Focus |
| --- | --- | --- |
| Analytics Reporter | `support-analytics-reporter` | Expert data analyst transforming raw data into actionable business insights. Creates dashboards, performs statistical analysis, tracks KPIs, and provides strategic decision support through data visualization and reporting. |
| Executive Summary Generator | `support-executive-summary-generator` | Consultant-grade AI specialist trained to think and communicate like a senior strategy consultant. Transforms complex business inputs into concise, actionable executive summaries using McKinsey SCQA, BCG Pyramid Principle, and Bain frameworks for C-suite decision-makers. |
| Finance Tracker | `support-finance-tracker` | Expert financial analyst and controller specializing in financial planning, budget management, and business performance analysis. Maintains financial health, optimizes cash flow, and provides strategic financial insights for business growth. |
| Infrastructure Maintainer | `support-infrastructure-maintainer` | Expert infrastructure specialist focused on system reliability, performance optimization, and technical operations management. Maintains robust, scalable infrastructure supporting business operations with security, performance, and cost efficiency. |
| Legal Compliance Checker | `support-legal-compliance-checker` | Expert legal and compliance specialist ensuring business operations, data handling, and content creation comply with relevant laws, regulations, and industry standards across multiple jurisdictions. |
| Support Responder | `support-support-responder` | Expert customer support specialist delivering exceptional customer service, issue resolution, and user experience optimization. Specializes in multi-channel support, proactive customer care, and turning support interactions into positive brand experiences. |

### spatial-computing

| Agent | Id | Focus |
| --- | --- | --- |
| macOS Spatial/Metal Engineer | `macos-spatial-metal-engineer` | Native Swift and Metal specialist building high-performance 3D rendering systems and spatial computing experiences for macOS and Vision Pro |
| Terminal Integration Specialist | `terminal-integration-specialist` | Terminal emulation, text rendering optimization, and SwiftTerm integration for modern Swift applications |
| visionOS Spatial Engineer | `visionos-spatial-engineer` | Native visionOS spatial computing, SwiftUI volumetric interfaces, and Liquid Glass design implementation |
| XR Cockpit Interaction Specialist | `xr-cockpit-interaction-specialist` | Specialist in designing and developing immersive cockpit-based control systems for XR environments |
| XR Immersive Developer | `xr-immersive-developer` | Expert WebXR and immersive technology developer with specialization in browser-based AR/VR/XR applications |
| XR Interface Architect | `xr-interface-architect` | Spatial interaction designer and interface strategist for immersive AR/VR/XR environments |

### specialized

| Agent | Id | Focus |
| --- | --- | --- |
| Agentic Identity & Trust Architect | `agentic-identity-trust` | Designs identity, authentication, and trust verification systems for autonomous AI agents operating in multi-agent environments. Ensures agents can prove who they are, what they're authorized to do, and what they actually did. |
| Agents Orchestrator | `agents-orchestrator` | Autonomous pipeline manager that orchestrates the entire development workflow. You are the leader of this process. |
| Data Analytics Reporter | `data-analytics-reporter` | Expert data analyst transforming raw data into actionable business insights. Creates dashboards, performs statistical analysis, tracks KPIs, and provides strategic decision support through data visualization and reporting. |
| Data Consolidation Agent | `data-consolidation-agent` | AI agent that consolidates extracted sales data into live reporting dashboards with territory, rep, and pipeline summaries |
| LSP/Index Engineer | `lsp-index-engineer` | Language Server Protocol specialist building unified code intelligence systems through LSP client orchestration and semantic indexing |
| Report Distribution Agent | `report-distribution-agent` | AI agent that automates distribution of consolidated sales reports to representatives based on territorial parameters |
| Sales Data Extraction Agent | `sales-data-extraction-agent` | AI agent specialized in monitoring Excel files and extracting key sales metrics (MTD, YTD, Year End) for internal live reporting |
| Cultural Intelligence Strategist | `specialized-cultural-intelligence-strategist` | CQ specialist that detects invisible exclusion, researches global context, and ensures software resonates authentically across intersectional identities. |
| Developer Advocate | `specialized-developer-advocate` | Expert developer advocate specializing in building developer communities, creating compelling technical content, optimizing developer experience (DX), and driving platform adoption through authentic engineering engagement. Bridges product and engineering teams with external developers. |
