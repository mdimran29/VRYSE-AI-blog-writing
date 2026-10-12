# **VRYSE — AI-Powered Blog Writing System**

## **Software Engineer Take-Home Assessment**

---

### **1\. Overview**

VRYSE is building an AI-powered content generation system capable of producing company-specific blog content based on existing human-written articles.

For this assessment, you will be provided with a collection of **human-written articles in Word document format**. These articles may cover different companies, topics, and writing styles.

The objective is to build a system that can analyze these examples, understand the characteristics of the target company's content, and generate new content that is **structurally, stylistically, and contextually appropriate** for that company.

The focus of this assignment is not simply generating a good article using an LLM. We are particularly interested in how you design the system to:

* Understand unstructured human-written content  
* Extract meaningful writing and structural patterns  
* Generate company-specific content  
* Evaluate the generated output  
* Incorporate human feedback  
* Demonstrate measurable improvement across iterations

You are expected to implement the minimum baseline described below. You are free to modify, extend, or replace parts of the baseline if you believe your approach produces a better result.

---

# **2\. Core System Requirements**

The system should consist of three primary stages.

## **Stage 1 — Content & Format Analysis**

The first stage should analyze the relevant human-written reference articles and derive the characteristics required for generating new content for the target company.

The analysis should capture information such as:

* Article structure  
* Section organization  
* Heading patterns  
* Paragraph structure  
* Writing style  
* Tone of voice  
* Sentence characteristics  
* Level of detail  
* Vocabulary and terminology  
* Use of examples  
* Use of data, statistics, or references  
* Introduction and conclusion patterns  
* Content length  
* Formatting conventions  
* Other company-specific writing characteristics

The output of this stage should be a structured representation of the **company's content style and format** that can be used by the generation stage.

The system should avoid simply passing entire reference documents into the generation prompt without analysis. The goal is to demonstrate that the system can extract reusable patterns from the reference material.

---

## **Stage 2 — Content Generation**

The second stage should generate a new article using:

1. The article requirements provided by the user  
2. The insights derived from the reference articles  
3. The target company's writing characteristics  
4. Any additional relevant context available to the system

The generated article should aim to reflect the characteristics of the human-written reference material rather than producing generic AI-generated content.

The system should consider factors such as:

* Required topic  
* Target audience  
* Desired article length  
* Required structure  
* Company-specific tone  
* Writing style  
* Terminology  
* Formatting  
* Content depth  
* Key points that must be covered

The generation process should be designed so that the system can be iterated upon based on evaluation results and human feedback.

---

## **Stage 3 — Quality Evaluation**

The third stage should evaluate the generated article against the expected requirements and the characteristics derived from the reference content.

The evaluation should provide **meaningful performance indicators rather than only a pass/fail result**.

The system should identify strengths, weaknesses, and areas where the generated content does not sufficiently match the expected output.

Possible evaluation dimensions include:

* Structural / format adherence  
* Relevance to the requested topic  
* Style similarity  
* Tone consistency  
* Readability  
* Completeness  
* Content quality  
* Requirement adherence  
* Company-specific characteristics  
* Human evaluation

The evaluation should ideally produce both:

**Quantitative indicators**

For example:

* Overall score  
* Structure score  
* Style score  
* Relevance score  
* Readability score  
* Completeness score

**Qualitative feedback**

For example:

* Sections that are missing  
* Tone inconsistencies  
* Areas that sound generic  
* Requirements that were not addressed  
* Structural differences from reference articles  
* Specific recommendations for improvement

---

# **3\. Human Feedback & Iterative Improvement**

The system must provide a mechanism for a human reviewer to evaluate and improve the generated content.

The reviewer should be able to:

1. View the generated article  
2. View the system's evaluation and performance indicators  
3. Provide feedback  
4. Trigger another generation iteration  
5. View the improved output  
6. Compare the previous and improved versions

Human feedback should be incorporated into subsequent generation iterations.

The system should demonstrate that feedback can actually influence the next output rather than simply being stored.

### **Required Demonstration**

At least **one complete feedback-and-improvement cycle** must be demonstrated.

For example:

**Initial Generation → Evaluation → Human Feedback → Regeneration → Improved Generation → Re-evaluation**

Where possible, the system should demonstrate that the evaluation scores or qualitative quality indicators improve after the feedback cycle.

---

# **4\. User Interface**

Build a simple interface through which a user can interact with the complete workflow.

The UI does not need to be production-grade.

The primary objective is to make the workflow understandable and usable.

The interface should allow the user to:

### **Input**

* Provide article requirements  
* Select or specify the target company  
* Provide any required article parameters

### **Generation**

* Generate the article  
* View the generated article

### **Evaluation**

* View the evaluation results  
* View individual performance indicators  
* Understand the main weaknesses identified by the system

### **Feedback**

* Provide human feedback  
* Trigger another generation iteration

### **Improvement**

* View the improved article  
* Compare the original and improved versions  
* View updated evaluation results

A simple web interface is sufficient.

---

# **5\. Evaluation & Metrics**

You should define the metrics you believe are appropriate for evaluating the generated content.

There is no single required evaluation methodology.

Your implementation should explain:

1. **Which metrics you selected**  
2. **Why those metrics are relevant**  
3. **How each metric is calculated**  
4. **How the metrics are combined into an overall assessment**  
5. **How you determine whether an iteration has improved**

Potential metrics include:

### **5.1 Structural / Format Adherence**

Measures how closely the generated article follows the structure identified from the reference content.

Examples:

* Heading hierarchy  
* Number of sections  
* Introduction structure  
* Conclusion structure  
* Paragraph organization  
* Formatting patterns

### **5.2 Relevance**

Measures whether the generated content directly addresses the requested topic and requirements.

### **5.3 Style Similarity**

Measures how closely the generated article reflects the writing characteristics of the reference articles.

This may include:

* Sentence length  
* Vocabulary  
* Paragraph length  
* Writing patterns  
* Level of detail  
* Use of specific terminology

### **5.4 Tone**

Measures whether the generated content maintains the expected company-specific tone.

Examples:

* Professional  
* Conversational  
* Technical  
* Educational  
* Persuasive  
* Informational

### **5.5 Readability**

Measures whether the article is easy to understand for the intended audience.

Possible signals include:

* Sentence complexity  
* Paragraph length  
* Readability scores  
* Clarity

### **5.6 Completeness**

Measures whether all required topics, sections, and information have been addressed.

### **5.7 Human Evaluation**

Human feedback can be used as an additional evaluation signal.

The system may allow reviewers to provide:

* Rating  
* Free-form feedback  
* Specific improvement requests  
* Approval / rejection

---

# **6\. Improvement Beyond the Baseline**

The baseline requirements above are intentionally open-ended.

You may improve any component of the system if you believe it will produce better results.

Potential areas for improvement include:

## **6.1 Reference Article Retrieval**

Instead of providing all reference documents to the model, consider retrieving only the most relevant examples.

Possible approaches include:

* Semantic search  
* Embeddings  
* Vector databases  
* Metadata filtering  
* Hybrid search  
* Company/topic-based retrieval

---

## **6.2 Context Management**

Consider how information extracted from reference articles is represented and passed between different stages of the system.

For example:

**Raw Articles → Extracted Insights → Structured Style Profile → Generation Context**

This may provide better consistency than repeatedly passing large amounts of raw content.

---

## **6.3 Agent Architecture**

You may choose to implement a multi-step or agentic workflow.

For example:

**Research / Retrieval Agent → Style Analysis → Content Planner → Writer → Evaluator → Revision**

The architecture should be justified based on the problem rather than using agents unnecessarily.

---

## **6.4 Prompting Strategy**

You may experiment with different prompting strategies to improve:

* Style consistency  
* Requirement adherence  
* Content quality  
* Structural consistency  
* Iterative improvement

---

## **6.5 Content Generation**

You may improve the generation pipeline through techniques such as:

* Outline-first generation  
* Section-by-section generation  
* Draft → critique → revision  
* Structured generation  
* Self-evaluation  
* Constraint-based generation

---

## **6.6 Evaluation Methodology**

You may implement a more sophisticated evaluation system using:

* LLM-as-a-judge  
* Rule-based checks  
* Embedding similarity  
* Readability metrics  
* Structural comparison  
* Human feedback  
* Combined scoring

A strong solution should explain the limitations of the chosen evaluation methodology.

---

## **6.7 Feedback Mechanism**

Consider how human feedback is converted into actionable instructions for the next generation.

For example:

**Human Feedback → Structured Revision Instructions → Regeneration**

Rather than simply appending raw feedback to the next prompt, you may transform feedback into specific changes that the generation system can apply.

---

## **6.8 Memory**

You may consider whether useful information from previous generations and feedback should be retained.

Examples:

* Company style profile  
* Previous feedback  
* Known writing preferences  
* Common mistakes  
* Successful generation patterns

---

## **6.9 Cost & Latency**

Consider the cost and latency implications of your architecture.

You may explain:

* Number of model calls  
* Context size  
* Retrieval strategy  
* Model selection  
* Opportunities for caching  
* Opportunities for parallel processing

---

## **6.10 Reliability & Observability**

Where appropriate, consider how you would monitor the system in a real-world environment.

Examples include:

* Generation failures  
* Evaluation failures  
* Model latency  
* Token usage  
* Cost per article  
* Quality scores  
* Iteration count  
* User feedback

You are not expected to implement production-grade observability.

---

# **7\. Architecture**

Provide a clear architecture overview of your implementation.

The architecture should explain the major components and how information flows through the system.

A possible high-level workflow is:

**Reference Documents**

↓

**Document Parsing**

↓

**Content / Style Analysis**

↓

**Structured Company Style Profile**

↓

**Article Requirements**

↓

**Reference Retrieval / Context Selection**

↓

**Content Planning**

↓

**Article Generation**

↓

**Quality Evaluation**

↓

**Human Review**

↓

**Human Feedback**

↓

**Revision Instructions**

↓

**Improved Article**

↓

**Re-evaluation**

The exact architecture is up to you.

You should explain why you selected your architecture and how the different components interact.

---

# **8\. Technical Expectations**

There is no fixed technology stack for this assignment.

You are free to use the tools, frameworks, models, databases, and technologies you are most comfortable with.

The technology choices should be appropriate for the problem and should be explained in the README.

Potential areas include:

* LLM APIs  
* Python / TypeScript / JavaScript  
* Backend frameworks  
* Frontend frameworks  
* Vector databases  
* Embedding models  
* Document parsing libraries  
* Structured output  
* Agent frameworks

You are not required to use a specific framework.

---

# **9\. Required Deliverables**

Please submit the following:

### **1\. Working Application**

A functional implementation demonstrating the complete workflow.

### **2\. Source Code**

Complete source code required to run the application.

### **3\. Architecture Overview**

A clear explanation of the system architecture and data flow.

### **4\. README**

The README should include:

* Project overview  
* Architecture  
* Technology choices  
* Setup instructions  
* Environment variables  
* How to run the application  
* How to use the application  
* Evaluation methodology  
* Design decisions  
* Known limitations  
* Potential future improvements

### **5\. Design Decisions**

Provide a brief explanation of the major engineering decisions you made and why.

This should include the reasoning behind:

* Reference content analysis  
* Retrieval strategy  
* Generation strategy  
* Evaluation approach  
* Feedback mechanism  
* Model selection  
* Any significant architectural choices

### **6\. Before & After Example**

Provide at least one example demonstrating:

**Initial Output**

→ **Evaluation**

→ **Human Feedback**

→ **Improved Output**

→ **Updated Evaluation**

The example should demonstrate how the system responds to human feedback and whether the resulting output improves.

---

# **10\. Time Limit**

The expected time limit for this assignment is:

**3 days**

The goal is **not** to build a production-ready system.

We are primarily interested in evaluating your:

* Engineering judgment  
* System design  
* Agentic workflow design  
* Evaluation approach  
* Ability to work with unstructured human-written content  
* Ability to build a meaningful feedback loop  
* Ability to identify weaknesses in the baseline  
* Ability to improve the system based on evidence

You should prioritize the parts of the system that you believe have the greatest impact on the quality of the final output.

---

# **11\. What We Are Looking For**

There is **no single expected solution**.

We are interested in how you approach the problem and the reasoning behind your implementation.

A strong submission should demonstrate:

### **Engineering Judgment**

Thoughtful technology and architecture choices rather than unnecessary complexity.

### **Understanding of LLM Systems**

An understanding that high-quality content generation requires more than a single prompt and model call.

### **Evaluation Thinking**

A meaningful approach to measuring quality rather than relying solely on subjective judgment.

### **Feedback Loops**

A mechanism through which human feedback can directly improve subsequent outputs.

### **Working Software**

A simple but functional application demonstrating the complete workflow.

### **Clear Reasoning**

The ability to explain what you built, why you built it, what works, what does not, and what you would improve with additional time.

---

# **12\. Final Submission Checklist**

Before submitting, ensure that your project includes:

* Working application  
* Source code  
* Reference document processing  
* Content / format analysis  
* Article generation  
* Quality evaluation  
* Quantitative performance indicators  
* Human feedback mechanism  
* Regeneration based on feedback  
* Before/after improvement example  
* Architecture documentation  
* README  
* Setup and run instructions  
* Design decisions  
* Evaluation methodology  
* Known limitations  
* Potential future improvements

---

## **Final Note**

You are encouraged to go beyond the baseline where you believe it meaningfully improves the system.

However, given the **3-day time limit**, prioritize a solution that is:

**Functional → Measurable → Iterative → Explainable**

rather than attempting to build a highly complex production architecture.

There is no single correct implementation. We will evaluate the quality of the engineering decisions, the effectiveness of the workflow, and the ability of the system to demonstrate measurable improvement through evaluation and human feedback.

[**https\://docs.google.com/spreadsheets/d/1NXpPCV5JKktbgLMoDMB\_SyBng7XYmdewfHDDs40qWm0/edit?gid=1899715019\#gid=1899715019**](https://docs.google.com/spreadsheets/d/1NXpPCV5JKktbgLMoDMB_SyBng7XYmdewfHDDs40qWm0/edit?gid=1899715019#gid=1899715019)

Link for the excel where we have existing blogs for a client named Protecto AI.