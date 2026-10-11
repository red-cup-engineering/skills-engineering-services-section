---
title: "LLM Training Stages as Algebraic Closure Operators"
domain: artificial-intelligence
relates-to:
  - ../terms/fine-tuning.md
  - ../terms/rlhf.md
  - ../../../../../../humanities/theories/math/theories/order/texts/closure-operators.md
date-created: 2026-04-04
references:
  hu2021lora:
    authors: ["Edward J. Hu", "Yelong Shen", "Phillip Wallis", "Zeyuan Allen-Zhu", "Yuanzhi Li", "Shean Wang", "Lu Wang", "Weizhu Chen"]
    title: "LoRA: Low-Rank Adaptation of Large Language Models"
    publication: "International Conference on Learning Representations"
    year: 2021
    url: "https://arxiv.org/abs/2106.09685"
  ouyang2022instructgpt:
    authors: ["Long Ouyang", "Jeff Wu", "Xu Jiang", "Diogo Almeida", "Carroll L. Wainwright", "Pamela Mishkin", "Chong Zhang", "Sandhini Agarwal", "Katarina Slama", "Alex Ray", "et al."]
    title: "Training language models to follow instructions with human feedback"
    publication: "Advances in Neural Information Processing Systems"
    year: 2022
    url: "https://arxiv.org/abs/2203.02155"
  rafailov2023dpo:
    authors: ["Rafael Rafailov", "Archit Sharma", "Eric Mitchell", "Christopher D Manning", "Stefano Ermon", "Chelsea Finn"]
    title: "Direct Preference Optimization: Your Language Model is Secretly a Reward Model"
    publication: "Advances in Neural Information Processing Systems"
    year: 2023
    url: "https://arxiv.org/abs/2305.18290"
---

A trained language model is a [closure](../../../../../../../../science-services-section/services/information-science-services-section/services/math-services-section/services/order-services-section/content/text/documents/notes/2026-03-01-note-on-closure-operators.md) fixed point: an element of a poset that is stable under further application of the training operator. LLM training stages form a sequence of increasingly constrained [closure operators](../../../../../../../../science-services-section/services/information-science-services-section/services/math-services-section/services/order-services-section/content/text/documents/notes/2026-03-01-note-on-closure-operators.md), each adding an additional constraint without rebuilding from scratch.

## Model weights as fixed points

A language model's weights represent a stable equilibrium under the training process. Once pre-training converges, reapplying the same training process to the same data produces negligible change. This is precisely what a [closure](../../../../../../../../science-services-section/services/information-science-services-section/services/math-services-section/services/order-services-section/content/text/documents/notes/2026-03-01-note-on-closure-operators.md) fixed point is: an element $W$ such that applying the closure operator again yields $c(W) \approx W$.

In the language model setting, let the training operator be $T_{\text{pretrain}}$: the process of updating weights on large-scale text data. Convergence means reaching weights $W^*$ such that $T_{\text{pretrain}}(W^*) \approx W^*$. This is the [least fixed point](../../../../../../../../science-services-section/services/information-science-services-section/services/math-services-section/services/order-services-section/content/text/documents/notes/2026-03-01-note-on-closure-operators.md) of the pre-training closure — the minimal model stable under next-token prediction on the training corpus.

## Fine-tuning as constrained closure

[Fine-tuning](../../../glossary/terms/fine-tuning.md) applies a second closure operator to the already-closed pre-trained model. Rather than starting from random initialization and training from scratch, fine-tuning freezes most of the model's structure and applies additional constraints. The key insight is that fine-tuning does not unbind the pre-training fixed point; it tightens it.

**LoRA (Low-Rank Adaptation; Hu et al., 2021)** makes this structure explicit. During fine-tuning, the weight update is decomposed as $\Delta W = B A$, where $A$ and $B$ are low-rank matrices ($A \in \mathbb{R}^{r \times d}$, $B \in \mathbb{R}^{d \times r}$, with $r \ll d$). The base weights are frozen: $W_{\text{adapted}} = W^* + \Delta W = W^* + BA$.

This is a constrained transformation: instead of freely updating a $d \times d$ weight matrix (which requires $d^2$ parameters), the update is confined to a rank-$r$ subspace, reducing trainable parameters by orders of magnitude (e.g., from 7B to 60M for a 7B parameter model). The closure operator for fine-tuning is thus inflationary (extends the pre-trained fixed point) and monotone (task-specific data pulls the model in a consistent direction) but constrained to operate only in the low-rank complement.

## RLHF and preference-based closure

Reinforcement Learning from Human Feedback (Ouyang et al., 2022) applies a third closure operator, further constraining the model.

The RLHF pipeline has three stages:

1. **Supervised fine-tuning (SFT).** Fine-tune the base model on demonstration data, producing $W_{\text{SFT}}$.

2. **Reward model training.** Train a separate model $r_\phi$ to predict human preference. Given a (prompt, response) pair, $r_\phi$ outputs a scalar score. The reward model learns to satisfy $r_\phi(x, y_w) > r_\phi(x, y_l)$ for preferred responses $y_w$ and rejected responses $y_l$.

3. **Policy optimization.** Update the language model using Proximal Policy Optimization (PPO) to maximize expected reward while maintaining distance from the SFT model:

$$\mathcal{L}_{\text{PPO}} = \mathbb{E}[r_\phi(x, y) - \beta \cdot KL(P(y \mid x, W) \| P(y \mid x, W_{\text{SFT}})]$$

where $\beta$ is the penalty weight and $KL$ is Kullback-Leibler divergence.

The KL constraint is the operator's idempotent condition: applying the closure a second time should add nothing new. If the model has already converged under the reward model while staying within the KL ball around the SFT distribution, further optimization produces no change. The closure is thus extensive (pushes the model toward higher rewards), monotone (consistent preference direction), and idempotent in the limit (stabilizes when no improvement without exceeding the KL bound).

## DPO as simplified closure

Direct Preference Optimization (Rafailov et al., 2023) eliminates the separate reward model by directly optimizing policy on preference pairs. It uses the Bradley-Terry model of preference — assuming human judgments follow

$$P(y_w \succ y_l \mid x) = \sigma(r^*(x, y_w) - r^*(x, y_l))$$

where $r^*$ is the ground-truth reward function. The key mathematical insight is a change of variables: instead of fitting $r^*$ explicitly, DPO derives an optimal policy directly from preference data via maximum likelihood:

$$\mathcal{L}_{\text{DPO}} = -\log \sigma(\beta \log \frac{P_\theta(y_w \mid x)}{P_\theta(y_l \mid x)} - \beta \log \frac{P_{\text{ref}}(y_w \mid x)}{P_{\text{ref}}(y_l \mid x)})$$

where $P_\theta$ is the policy being optimized and $P_{\text{ref}}$ is the SFT reference model. The closed element under this closure is the policy that maximizes the log-likelihood of observed human preferences while remaining close to the reference distribution.

DPO is a [composite](../../../../../../../../science-services-section/services/information-science-services-section/services/math-services-section/services/order-services-section/content/text/documents/notes/2026-03-01-note-on-closure-operators.md) of two constraints — preference satisfaction and reference proximity — expressed as a single operator that skips the intermediate reward model stage. It is inflationary (moves toward preferred outputs), monotone (consistent preference direction), and idempotent (stops when preferences are satisfied up to the reference distance).

## In-context learning as temporary extension

In-context learning operates differently: it does not constrain the [closure](../../../../../../../../science-services-section/services/information-science-services-section/services/math-services-section/services/order-services-section/content/text/documents/notes/2026-03-01-note-on-closure-operators.md) fixed point, but extends the generator set that drives the model's output. Given a fixed set of weights $W^*$, including demonstrations in the prompt changes the model's conditional distribution $P(y \mid x, \text{prompt})$ without modifying $W^*$ itself.

The distinction is crucial. In [closure operator](../../../../../../../../science-services-section/services/information-science-services-section/services/math-services-section/services/order-services-section/content/text/documents/notes/2026-03-01-note-on-closure-operators.md) terms:
- Fine-tuning and RLHF modify the operator $c$, moving the model to a new fixed point.
- In-context learning modifies the input to the operator — the generator set — without changing $c$ itself.

The prompts act as a temporary expansion of the context window, creating a temporary shift in the model's behavior. When the context window closes, the model reverts to its original fixed point. The weights remain the persistent [closure](../../../../../../../../science-services-section/services/information-science-services-section/services/math-services-section/services/order-services-section/content/text/documents/notes/2026-03-01-note-on-closure-operators.md) fixed point; context is ephemeral.

## Composing operators in multi-stage training

These operators compose naturally. If $c_1$ is the pre-training closure, $c_2$ is the SFT fine-tuning closure, and $c_3$ is the RLHF closure, their composite $c_3 \circ c_2 \circ c_1$ is monotone and inflationary. By Knaster-Tarski, the composition has a [least fixed point](../../../../../../../../science-services-section/services/information-science-services-section/services/math-services-section/services/order-services-section/content/text/documents/notes/2026-03-01-note-on-closure-operators.md) — the smallest model stable under all three operators simultaneously.

This fixed point is precisely what practitioners call a "fully trained" instruction-following aligned language model: a set of weights that satisfies the pre-training objective (next-token prediction on diverse text), the instruction-following objective (SFT demonstrations), and the preference objective (RLHF reward). The iterative construction gives the training procedure a dynamic reading: start with random initialization, apply the composite operator, stabilize through convergence, and halt when no further improvement emerges.

The elegance of the formulation is that each stage tightens the constraint without requiring knowledge of the previous stages' details. [Fine-tuning](../../../glossary/terms/fine-tuning.md) doesn't need to know how pre-training works; RLHF doesn't need to know the structure of the fine-tuning closure. Each closure is inflationary and monotone, and their composition is guaranteed to have a fixed point by the Knaster-Tarski theorem.

## See also

- [Closure operators](../../../../../../../../science-services-section/services/information-science-services-section/services/math-services-section/services/order-services-section/content/text/documents/notes/2026-03-01-note-on-closure-operators.md)
- [Fine-tuning](../../../glossary/terms/fine-tuning.md)
- [RLHF](../../../glossary/terms/rlhf.md)
