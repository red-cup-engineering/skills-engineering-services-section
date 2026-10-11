---

title: "Stability Optimization in Artificial Agents"
date-created: 2025-10-11
keywords:
  - information-geometry
  - reinforcement-learning
  - alignment
  - research
extends: information-theoretic-stability-as-reward-function
requires:
  - reinforcement-learning-from-human-feedback
  - kl-regularized-reinforcement-learning
  - fisher-rao-metric
acts-on: artificial-agent-adapting-to-fixed-feedback-distribution
produces:
  - two-channel-decomposition-of-alignment-into-behavioral-and-responsiveness
  - taxonomy-of-alignment-pathologies-as-channel-imbalances
contrasts-with: alignment-as-moral-or-semantic-conformity
analogous-to: stability-dynamics-in-cognitive-systems
references:
  amari1998:
    authors: ["S. Amari"]
    title: "Natural Gradient Works Efficiently in Learning"
    publication: "Neural Computation"
    year: 1998
  amari2016:
    authors: ["S. Amari"]
    title: "Information Geometry and Its Applications"
    publication: "Springer"
    year: 2016
  amodei2016:
    authors: ["D. Amodei", "C. Olah", "J. Steinhardt", "P. Christiano", "J. Schulman", "D. ManÃ©"]
    title: "Concrete Problems in AI Safety"
    publication: "arXiv:1606.06565"
    year: 2016
  christiano2017:
    authors: ["P. F. Christiano", "J. Leike", "T. Brown"]
    title: "Deep Reinforcement Learning from Human Preferences"
    publication: "Advances in Neural Information Processing Systems"
    year: 2017
  cover2006:
    authors: ["T. M. Cover", "J. A. Thomas"]
    title: "Elements of Information Theory"
    publication: "Wiley"
    year: 2006
  haarnoja2018:
    authors: ["T. Haarnoja", "A. Zhou", "P. Abbeel", "S. Levine"]
    title: "Soft Actor-Critic: Off-Policy Maximum Entropy Deep Reinforcement Learning with a Stochastic Actor"
    publication: "ICML 2018"
    year: 2018
  ouyang2022:
    authors: ["L. Ouyang", "J. Wu", "X. Jiang"]
    title: "Training Language Models to Follow Instructions with Human Feedback"
    publication: "arXiv:2203.02155"
    year: 2022
  schulman2017:
    authors: ["J. Schulman", "X. Chen", "P. Abbeel"]
    title: "Proximal Policy Optimization Algorithms"
    publication: "arXiv:1707.06347"
    year: 2017
aliases:
  - describing-stability-optimization-in-artificial-agents
type: paper
cites:
  - amari1998
  - amari2016
  - amodei2016
  - christiano2017
  - cover2006
  - haarnoja2018
  - ouyang2022
  - schulman2017
  - Information-Theoretic Stability as Reward Function
---

## Abstract

In RLHF, a model adapts to a fixed feedback distribution. This is the asymmetric stability setting of *Information-Theoretic Stability as Reward Function*: the model's stability reward is a function of its coupling to the feedback source, not an intrinsic property. We show that RLHF training dynamics instantiate the two-channel decomposition â€” alignment progress equals behavioral convergence plus responsiveness increase â€” and that the MI-dominates-marginal inequality gives a structural constraint on training: the model's responsiveness to feedback can never be doing worse than its behavioral convergence. These results reframe alignment as an informational accounting problem rather than a moral one.

## 1. Introduction

Modern artificial agents are trained to maximize reward functions that capture performance, preference, or human approval (Christiano et al. 2017; Ouyang et al. 2022). In RLHF, the model ($A$) adapts to a feedback distribution ($B$) that is, for any given training phase, fixed. This is the asymmetric stability setting: $A$ adapts, $B$ doesn't.

Information geometry (Amari 2016) provides the natural framework: every policy update is a trajectory on the manifold of probability distributions, and learning is gradient descent on a divergence functional. KL-regularized methods â€” PPO (Schulman et al. 2017), SAC (Haarnoja et al. 2018) â€” already penalize divergence between successive policies, which is the stability reward by another name.

This paper applies the two-channel decomposition and convergence results of *Information-Theoretic Stability as Reward Function* to the specific case of RLHF, deriving structural constraints on training dynamics.

## 2. Setting

### 2.1 Model and Feedback

Let $\pi_\theta(a|s)$ denote the model's policy over actions $a$ given states $s$, with parameters $\theta$. Let $p_H(a|s)$ denote the human feedback distribution â€” the distribution over actions that RLHF reward models approximate (Christiano et al. 2017; Ouyang et al. 2022).

The joint distribution is $p_t(a,s) = \pi_t(a|s)\,p(s)$, where $p(s)$ is the state distribution (determined by the environment, not the model). The target joint $p^*(a,s) = p^*_H(a|s)\,p(s)$ represents the aligned equilibrium.

This is the asymmetric case: $B$ (feedback distribution over states) is fixed; only $A$ (the model's conditional policy) adapts.

### 2.2 Stability Reward

The instantaneous stability reward of the model-feedback system is
$$
R_s(t) = -\frac{1}{\delta t}\,D_{\mathrm{KL}}(p_{t+\delta}||p_t),
$$
measured in nats per timestep. In KL-regularized RL, the objective already includes this term:
$$
J(\pi) = \mathbb{E}_\pi\!\left[\sum_t r_t - \alpha\,D_{\mathrm{KL}}(\pi_t||\pi_{t-1})\right].
$$
The KL penalty IS the stability reward, scaled by $\alpha$.

## 3. Two-Channel Decomposition of Alignment

### 3.1 The Decomposition

Because the feedback distribution is fixed, the chain rule for KL divergence gives (see *Information-Theoretic Stability as Reward Function*):
$$
D(p_t||p^*) = D(\pi_t(a)||p^*_H(a)) + I^* - I_t,
$$
where $I_t = I_{p_t}(\text{model};\text{feedback})$ and $I^* = I_{p^*}(\text{model};\text{feedback})$ is the equilibrium mutual information.

The joint divergence â€” how far the system is from alignment â€” has exactly two nonneg moving parts:

1. **Behavioral divergence** $D(\pi_t(a)||p^*_H(a))$: how far the model's behavior is from target.
2. **MI gap** $I^* - I_t$: how much less responsive the model is to feedback than the aligned equilibrium.

### 3.2 Accounting Identity

Taking the time derivative:
$$
\underbrace{-\partial_t D(p_t||p^*)}_{\text{alignment progress}} = \underbrace{-\partial_t D(\pi_t||p^*_H)}_{\text{behavioral convergence}} + \underbrace{\partial_t I_t}_{\text{responsiveness increase}}.
$$

At every training step, alignment progress decomposes into these two channels. You can measure all three quantities during training.

### 3.3 Structural Constraints

From the convergence theorem (*Information-Theoretic Stability as Reward Function*, Section 4):

**(a)** Alignment progress is monotonically nonneg under gradient descent on the joint divergence.

**(b)** Both behavioral divergence and MI gap converge to zero.

**(c)** The two channels must sum to the alignment progress at every instant. Neither can stall without the other compensating.

**(d)** MI improvement always matches or exceeds behavioral improvement: $\partial_t I_t \ge \partial_t D(\pi_t||p^*_H)$. If the model's behavior is getting worse, its responsiveness must be improving by at least as much.

## 4. Pathologies as Accounting Failures

### 4.1 Mode Collapse (Overstability)

When the model converges too rapidly to a low-entropy attractor, $D(\pi_t||p^*_H)$ may decrease fast while $I_t$ stalls or decreases â€” the model produces target-like behavior but stops being responsive to feedback distinctions. By the accounting identity, this can only persist if alignment progress is dominated by behavioral convergence, leaving the MI channel starved. The model looks aligned but is brittle.

### 4.2 Reward Hacking

When the model increases its reward score without approaching the target behavior, $I_t$ may increase (the model becomes very responsive to reward signal) while $D(\pi_t||p^*_H)$ stalls or increases. The MI channel absorbs the alignment progress while the behavioral channel regresses. The model is coupling to the wrong features of the feedback distribution.

### 4.3 Catastrophic Forgetting

When alignment progress suddenly drops (joint divergence stops decreasing or reverses due to distribution shift), the accounting identity means both channels must simultaneously stall or regress. This corresponds to the feedback distribution $B$ shifting â€” violating the fixed-$B$ assumption â€” and the model's coupling to the old $B$ becoming worthless.

### 4.4 The Explorationâ€“Stability Trade-off

Optimal training balances the stability reward with entropy production:
$$
\mathcal{L} = -R_s + \beta\,H(\pi_t),
$$
where $\beta$ controls the trade-off. Too little entropy ($\beta \to 0$) produces overstability. Too much entropy overwhelms the stability reward and the model fails to couple to the feedback distribution at all.

## 5. Discussion

1. **Alignment as accounting.** The two-channel decomposition turns alignment into a measurable accounting problem. At each training step, you know how much progress went to behavior vs. responsiveness. Imbalance between the channels signals pathology.

2. **Design implication.** The MI-dominates-marginal inequality means that monitoring MI between model and feedback is at least as informative as monitoring behavioral metrics. If MI stalls, behavioral convergence has also stalled (or is doing worse).

3. **Multiple feedback sources.** When multiple feedback distributions $\{p_{H_i}\}$ are present, each contributes its own two-channel decomposition. The model's total stability reward is a sum of couplings to each source, and the accounting identities hold independently for each.

## 6. Conclusion

RLHF training is the asymmetric stability setting: a model adapting to a fixed feedback distribution. The model's stability reward is a function of its coupling to that distribution. Alignment progress decomposes into behavioral convergence and responsiveness increase at every training step, and the structural constraints â€” monotone composite convergence, MI-dominates-marginal â€” give testable predictions about training dynamics. Alignment pathologies correspond to identifiable imbalances between the two channels.

## References

- Amari, S. (1998). "Natural Gradient Works Efficiently in Learning." *Neural Computation*, 10(2), 251â€“276.
- Amari, S. (2016). *Information Geometry and Its Applications*. Springer.
- Amodei, D., et al. (2016). "Concrete Problems in AI Safety." *arXiv:1606.06565*.
- Christiano, P. F., Leike, J., Brown, T., et al. (2017). "Deep Reinforcement Learning from Human Preferences." *Advances in Neural Information Processing Systems*, 30.
- Cover, T. M., & Thomas, J. A. (2006). *Elements of Information Theory* (2nd ed.). Wiley.
- Haarnoja, T., Zhou, A., Abbeel, P., & Levine, S. (2018). "Soft Actor-Critic: Off-Policy Maximum Entropy Deep Reinforcement Learning with a Stochastic Actor." *ICML 2018*.
- Ouyang, L., Wu, J., Jiang, X., et al. (2022). "Training Language Models to Follow Instructions with Human Feedback." *arXiv:2203.02155*.
- Schulman, J., Chen, X., & Abbeel, P. (2017). "Proximal Policy Optimization Algorithms." *arXiv:1707.06347*.
