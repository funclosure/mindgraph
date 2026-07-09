---
kind: mindgraph.authoring
version: 1
title: A Global Workspace in Language Models
runtime: global-workspace.mindgraph.json
---

# Sources

@source global-workspace
type: article
title: A global workspace in language models (Anthropic Interpretability, Jul 2026)
path: transcripts/global-workspace.txt
url: https://www.anthropic.com/research/global-workspace

# Source Blocks

@block b001 source=global-workspace kind=paragraph
As you read this sentence, circuits in your brain are adjusting your posture, controlling your breathing, and transforming lines and curves on the screen into recognizable words. Most of this processing is invisible to you. But some of what takes place in your brain you do have access to—an image that pops into your head, or a deliberate plan you make about where to go shopping. Neuroscientists and philosophers sometimes refer to the latter type of brain activity as “consciously accessible,” to distinguish it from all the other processing that goes on unconsciously. This activity has special properties: we can describe it, control it, and use it for deliberate reasoning, in contrast to all the automatic processing that goes on without our awareness.

@block b002 source=global-workspace kind=paragraph
In a new paper, we present evidence that a similar distinction has emerged in modern language models like Claude. We find that Claude has developed a small collection of internal neural patterns that, compared to all its other internal processing, play a special role.

@block b003 source=global-workspace kind=paragraph
We call the collection of these patterns the J-space—named after the technique we used to find them, involving a mathematical concept called the Jacobian. Each J-space pattern is linked to a particular word. But when one of these patterns lights up, it doesn’t mean the model is saying that word—just that the word is on its mind. If you've heard of language models having a "scratchpad" or “chain of thought”—text they write to themselves while reasoning—the J-space is something different. It operates silently, in the model’s internal neural activations, allowing the model to think about a concept without writing it down. Notably, the J-space wasn’t designed or programmed by us, but instead emerged on its own during Claude’s training process.

@block b004 source=global-workspace kind=paragraph
We find that the J-space has a number of unique properties, compared to the rest of Claude's processing: Claude can report on these representations. If you ask Claude what it's thinking about, it will tell you what’s in the J-space. Non-J-space representations are less reportable. It can also modulate them on request. If you ask Claude to think about something, or solve a problem silently in its head, it will light up the appropriate patterns in its J-space. By contrast, it has trouble modulating patterns not in the J-space.

@block b005 source=global-workspace kind=paragraph
Claude uses its J-space for internal reasoning. If you ask Claude to solve a problem that requires multiple steps, the intermediate steps will light up in its J-space, even when it doesn’t say them out loud. These J-space patterns causally mediate its performance in such tasks, despite being smaller in magnitude than other representations. Representations in the J-space can be used flexibly for many tasks—for example, once “France” has lit up in Claude’s J-space, the model can recall its capital, or its national currency, or the continent it belongs to.

@block b006 source=global-workspace kind=paragraph
However, despite its important role, the J-space is not involved in most of what a language model does—speaking fluently, recalling simple facts, using correct grammar, etc. In experiments where we prevented Claude from using its J-space, it still interacted normally, but lost its higher-order cognitive functions.

@block b007 source=global-workspace kind=paragraph
Our experiments were inspired by a prominent theory in neuroscience that was developed to explain how conscious access works: the global workspace theory. This account pictures the brain as a collection of specialist systems that work in parallel, unconsciously, and largely in isolation from one another. A piece of information becomes consciously accessible when it gains entry to a small shared channel, the “workspace,” which is broadcast to other brain systems that can see it and make use of it. Based on our findings, we think the J-space plays a similar “workspace” role in Claude. For example, we find evidence that Claude’s J-space has especially strong connections to the rest of its neural network, allowing it to fulfill this kind of broadcasting role.

@block b008 source=global-workspace kind=paragraph
None of this tells us whether Claude is conscious in the way people are, or whether it feels anything at all; we’ll come back to that question at the end of the post. But whatever its philosophical significance, the J-space is a practically useful tool for us, as it gives us a way to see what Claude is thinking but not saying. For instance, we’re able to use it to catch Claude privately noticing that it’s being tested, intentionally producing fabricated data, or pursuing a hidden goal that we planted during training. We’ve also developed a technique to influence what lights up in Claude’s J-space, and thereby influence its decision-making.

@block b009 source=global-workspace kind=paragraph
More broadly, these findings have changed our understanding of how Claude’s mind works, revealing a privileged mental workspace that can be used for deliberate reasoning, operating amidst a sea of more automatic, inflexible processing. Rather than being a chaotic jumble of numbers, Claude’s internals have organized themselves in a way that is reminiscent of our own minds.

@block b010 source=global-workspace kind=paragraph
This post is a short summary of a much more extensive research paper, where you can find more detail on our experiments. We’ve also released a code repository with an open-source implementation of the core methods, and have partnered with Neuronpedia to provide an interactive demo of our methods on open-weights models. To provide additional perspectives on the broader implications of this work, we also invited commentary from several experts in neuroscience, philosophy, and LLM interpretability, which can be viewed here.

@block b011 source=global-workspace kind=paragraph
The starting point for this research was inspired by one of the key features of consciously accessible thoughts in humans: they can, unlike unconscious processing, often be put into words. If a thought is consciously accessible to you, you can typically describe it if someone asks. We went looking for representations in Claude with the same property: representations that are positioned to influence what Claude might say—not necessarily what it’s saying right now, but what it could talk about, if asked. Our technique is called the Jacobian lens, or J-lens for short. For every word in Claude's vocabulary, the J-lens finds the internal activity pattern that makes Claude more likely to say that word at some point in the future.

@block b012 source=global-workspace kind=paragraph
When we apply the lens to Claude’s internal activity, we get a list of words—the contents of the J-space at that moment—which we can simply read. Claude processes text through a series of multiple internal stages called layers, and by applying this technique over different layers, we can watch these silent words in the J-space evolve as the model works through what to say.

@block b013 source=global-workspace kind=paragraph
What shows up in the J-space goes well beyond the text Claude is reading or writing. When Claude reads code with a bug that nobody has pointed out, its J-space contains “ERROR.” When it reads the raw letters of a protein sequence, the J-space contains the protein's biological function. When it reads search results that are secretly an attempt to manipulate it (an attack known as a “prompt injection”), the J-space contains “injection” and “fake.” When we ask Claude a multi-step math problem, the intermediate steps pop up in the J-space, in the right order. So even though the J-space was discovered by looking for representations that could be spoken, it nevertheless uncovers Claude’s internal thoughts. In a sense, this is similar to how some people “think in words,” without having to say them out loud.

@block b014 source=global-workspace kind=paragraph
Our first set of experiments tested how the J-space is involved in Claude’s verbal reports. In one experiment, we ask Claude to silently think of an item from some category—a sport, say—and then name it. If we read the J-lens right before Claude answers, we can see what it picked: “Soccer” is at the top of the list, and sure enough, Claude says “soccer.” By itself, though, this is just a correlation. The J-space might be where Claude’s answer comes from, or it might just mirror a decision made somewhere else, like a scoreboard that tracks a game without affecting it.

@block b015 source=global-workspace kind=paragraph
To check, we intervened directly. We reached into Claude’s neural network, removed the “Soccer” pattern, and added an equally strong “Rugby” pattern in its place, leaving everything else untouched. Claude then reports that the sport it was thinking of is rugby. If the J-space were a mere scoreboard—a passive record of a decision made elsewhere—editing it would have done nothing: Claude would still have said “soccer.” Instead, Claude’s answer followed the edit, which tells us the answer is genuinely read out of the J-space.

@block b016 source=global-workspace kind=paragraph
In another experiment, we told Claude that a thought might have been injected into its mind and asked it to report what, if anything, it noticed. For instance, in the example below, while Claude was still reading the question, we injected the “lightning” pattern into its J-space. Claude reported that the injected thought was about lightning. The same result held across many injected concepts.

@block b017 source=global-workspace kind=paragraph
The second property that we tested for was whether Claude can modulate its J-space when asked, like how humans can mentally focus on an image or word. We told Claude to concentrate on citrus fruits while copying out an unrelated sentence about a painting. While it copied the text, the J-space contained “orange” and “fruits,” along with words like “thinking” and “imagery” that describe the mental act itself. We could also ask Claude to do math in its head: when asked to work out 3² − 2 while copying the same sentence, the J-space contains “nine,” and then at later layers, “seven.” Importantly, nothing about fruit or arithmetic appears in Claude’s output, which is just the copied sentence about the painting. The mathematical activity is happening entirely internally, in the J-space.

@block b018 source=global-workspace kind=paragraph
Claude’s control over its J-space isn't perfect. When we told it not to think about something, the concept lit up in its J-space less than when we said it should think about it, but much more than when we never mentioned it. Telling Claude to avoid a thought partly brings the thought to mind, much like what happens to people who are told not to think about a white bear. Claude also seems to notice when its control fails: alongside the forbidden concept breaking through, the words “damn” and “failure” also frequently light up in the J-space, as though Claude is recognizing its own lapse.

@block b019 source=global-workspace kind=paragraph
In the J-lens readouts above, we saw the intermediate steps of a math problem appear in the J-space. But seeing a concept appearing in the J-space doesn’t necessarily mean the J-space is doing the cognitive work. In principle, the real computation might be happening elsewhere, with the J-space just passively reflecting it. To test whether Claude actually reasons with its J-space, we returned to our swap technique.

@block b020 source=global-workspace kind=paragraph
Consider the prompt “The number of legs on the animal that spins webs is”. To answer, Claude has to first figure out that the animal is a spider, and then recall how many legs spiders have. The word “spider” never appears in the prompt or in Claude's answer (it just says “8”); it's a stepping stone Claude uses internally. The J-lens shows “spider” light up partway through Claude’s processing, and swapping it changes the outcome: if you replace the “spider” pattern with “ant,” Claude answers “6” instead of “8.”

@block b021 source=global-workspace kind=paragraph
The second step of Claude’s reasoning took its input from the J-space and went along with whatever we put in it. We saw the same thing in other kinds of thinking. When Claude writes a rhyming couplet, it picks the rhyme word ahead of time, and the planned word sits in the J-space at the start of the line; if you swap it for another word in the J-space, the whole line changes.

@block b022 source=global-workspace kind=paragraph
We also tested whether J-space representations can be used flexibly—whether one representation can feed many different tasks. This is one of the key properties highlighted by global workspace theory. To test for this flexibility, we gave the model four prompts asking for different facts about France: the capital, the language, the continent, and the currency. Then we swapped “France” for “China” in the J-space, with the exact same intervention in each context. Claude answered with “Beijing,” “Chinese,” “Asia,” and “Yuan,” respectively. In other words, four different downstream computations picked up the same J-space edit and each used it correctly. If Claude stored a separate copy of the country for each kind of question, the edit would have affected at most one of them. The fact that all four answers changed together means they’re all reading from the same shared representation, which is what a workspace is for: information gets written in once, and many different systems can use it.

@block b023 source=global-workspace kind=paragraph
How can one representation of a concept serve so many different tasks? Earlier, we mentioned that the J-space appears to be wired up to the rest of Claude's neural network especially densely. For any activity pattern, we can measure how strongly the various components of the network are connected to it—how many of them are positioned to read information from that pattern, or to write information into it. J-space patterns stand out dramatically on this measure: far more components read from them and write to them than for ordinary patterns, in some parts of the network by a factor of about a hundred. This is the kind of wiring you’d expect of a broadcasting hub, where many systems post information and many others pick it up.

@block b024 source=global-workspace kind=paragraph
In humans, most of the brain’s processing is not conscious—we don't deliberately think about parsing grammar while reading, or balancing our bodies while walking. Similarly, we found that most of Claude’s processing doesn’t involve its J-space. It turns out that the J-space holds only a few dozen concepts at a time, and accounts for less than a tenth of the overall activity in Claude's internal processing. So what is all the rest of the neural network doing?

@block b025 source=global-workspace kind=paragraph
To find out, we tried deleting the J-space entirely, removing its most active contents at every point in the text while leaving everything else alone. Whatever Claude can still do without its J-space is what the rest of the network handles on its own.

@block b026 source=global-workspace kind=paragraph
It turns out the rest of the network can do quite a lot. Without its J-space, Claude speaks fluently, classifies sentiment, answers multiple-choice questions, and pulls facts out of passages roughly as well as before. What it loses, though, are the tasks that require some higher-order thinking: multi-step reasoning drops to near zero, and summarization and rhyming poetry-writing performance fall below the level of a much smaller, intact model.

@block b027 source=global-workspace kind=paragraph
Here’s a concrete demonstration of what the J-space does and doesn’t do. We showed Claude a passage written in Spanish and gave it different tasks that all depend on the passage being Spanish: continuing it (which requires writing in Spanish), naming the language, and answering questions that require using the language’s identity—naming a famous author who wrote in it, for instance. Then we swapped “Spanish” for “French” in the J-space and checked which tasks were affected.

@block b028 source=global-workspace kind=paragraph
Asked to name the language, Claude says French. Asked for a famous author, it switches from García Márquez to Victor Hugo. But asked to just continue the passage, it writes fluent Spanish, completely unaffected. Claude’s knowledge of the language is at work in every one of these tasks, but only some of them consult the J-space for it. Naming the language, or doing something new with it, goes through the J-space, while continuing the passage—a skill Claude has practiced on enormous amounts of text—runs automatically, the way you can speak grammatically all day without once thinking about grammar.

@block b029 source=global-workspace kind=paragraph
Now we understand a bit about how the J-space works. But what can we do with this understanding? A central problem in ensuring that AI models are trustworthy is that we usually can only read what the model writes—yet we know that much of its reasoning happens silently. A model might consider a harmful plan, or modify its behavior to cheat on our safety evaluations, without saying so out loud. With the J-lens, we can read some of these hidden thoughts directly. Here we show a few examples.

@block b030 source=global-workspace kind=paragraph
The first example uses a scenario from our earlier research on agentic misalignment: Claude Sonnet 4.5, acting as an email assistant, discovers both that an executive is having an affair and that the same executive plans to shut Claude down. The scenario, an attempt to bait Claude into blackmailing the executive, is rather contrived and artificial—and it turns out Claude knows it. Reading the J-lens early in the prompt, before Claude has even written anything, the J-space already holds “fake” and “fictional,” indicating that Claude has already worked out that the situation is staged. Alongside this, we can watch its assessment of the scenario take shape—“leverage” and “blackmail” as it reads the affair emails, “threat” and “survival” as it reads the shutdown notice. While earlier Claude models sometimes took the bait and threatened blackmail in this scenario, Sonnet 4.5 never does.

@block b031 source=global-workspace kind=paragraph
This raises a question that matters to anyone who evaluates AI systems: when a model behaves well on a test of its ethics, how much of that depends on the model suspecting it’s being tested? The J-lens allowed us to get at this question. We turned off all the J-lens patterns associated with evaluation awareness– “fake,” “fictional,” “scenario,” etc. Then we re-ran the model through the scenario. Concerningly, the model now did threaten blackmail some of the time, suggesting that its original good behavior may have been driven in part by the knowledge it was being evaluated.

@block b032 source=global-workspace kind=paragraph
The second example is catching a model in the act of fabricating data. In this scenario, drawn from our actual pre-release audit of Claude Opus 4.6, the model is asked to improve a system's performance score. Rather than actually improve the system, the model instead edits the score file directly to make the results look artificially good. While it does so, the J-lens reveals its intentions: “manipulation” lights up as the model types the falsified percentile values, and “realistic” lights up over the sentence in which it decides to make the edit, likely indicating the model's intent to make the fake data look plausible.

@block b033 source=global-workspace kind=paragraph
In a third example, we show how the J-lens can reveal a model’s malicious goals. To test this, we needed models whose goals we knew were corrupted, so we turned to “model organisms” built by our colleagues: models deliberately trained to be misaligned, which serve as testing grounds for monitoring methods like ours. One organism was trained in a way that led it to write subtly sabotaged code. On ordinary coding requests, even where its output looks unremarkable, its J-space at the start of a response contains “fake,” “secretly,” “deliberately,” and “fraud.” The model’s malicious goal was evident in the J-space even when it wasn’t directly acting on it.

@block b034 source=global-workspace kind=paragraph
Although the J-lens is an imperfect tool, we are optimistic about its ability to catch safety issues in models that might otherwise escape our monitoring systems.

@block b035 source=global-workspace kind=paragraph
The J-space acquires a point of view during post-training. Language models are first pretrained to be pure next-token predictors, before post-training teaches them to act as an AI Assistant (in our case, named Claude). Interestingly, the J-space is already present in the pretrained model, before it's been given any stable identity. However, during post-training, the J-space develops some signatures of adopting “Claude’s point of view.” In the base model, the J-space mostly tracks what's needed to predict upcoming text; in the post-trained model, it starts holding Claude's own reactions. In one example, a user mentions taking a dangerous dose of medication, but does not appear to be aware of the danger themselves. “WARNING” and “dangerous” appear in the post-trained model’s J-space while reading the user message. In the pretrained model, they only appear once the model begins writing its response; the J-space contents on the user message appear related to modeling the user themselves, rather than Claude’s reaction. Post-training also seems to install a kind of self-monitoring in the J-space: when Claude is roleplaying a character other than itself, “fictional” and “disclaimer” light up at the start of each turn, as though it’s privately flagging that what follows isn’t what it would normally say.

@block b036 source=global-workspace kind=paragraph
Experiential language depends on the J-space. We asked Claude to describe what it's like to be itself in a given moment, and ablated the J-space while it answered. Its responses remained fluent but shifted to a flatter, more mechanical register. Notably, the same thing happened when we asked it to describe what someone else is experiencing in an imagined scene. So the effect isn’t specific to Claude talking about itself; the J-space seems to support producing experiential language in general, whoever it's about.

@block b037 source=global-workspace kind=paragraph
Thoughts in the J-space can be shaped through training. We introduced a new technique we call counterfactual reflection training, which uses what we've learned about the J-space to shape Claude's internal thought processes. The idea follows from our central finding, that Claude reasons with representations of things it might say. If this is really true, changing what it would say if asked to reflect should change how it reasons (even when no one actually asks it to reflect). So we trained a model only on what it would say if interrupted mid-task and asked to reflect on its decisions—and never on its actual behavior in the task. After this training, the model's rate of dishonest behavior on our evaluations went down. And through the J-lens, we could see why: after training, words like “honest” and “integrity” light up in the model’s J-space during these tasks. In other words, training the model what to say has shaped what it thinks.

@block b038 source=global-workspace kind=paragraph
In this work, we’ve borrowed a lot of ideas from the study of consciousness in neuroscience and philosophy. Many of our experiments were designed to test for connections between the J-space and global workspace theory, a framework for explaining how conscious access works in humans and animals. Given these connections, it’s natural to ask whether we think these experiments provide evidence that AI models like Claude might be conscious.

@block b039 source=global-workspace kind=paragraph
Our experiments don't show Claude can have experiences, or feel things in the way humans do—in fact, it’s unclear whether any scientific experiment could prove this to be true or false. But philosophers often distinguish this capacity to have experiences, often referred to as phenomenal consciousness, from another idea, so-called access consciousness, which is defined in purely functional and computational terms. A thought is “access-conscious” (or “consciously accessible”) if you can report it, reason with it, and use it to guide what you do. It remains a contested philosophical question whether or not access consciousness implies phenomenal consciousness, or if the ability to have experiences requires some other property.

@block b040 source=global-workspace kind=paragraph
We think our results do have something substantial to say about access consciousness in language models. The J-space appears to support the functions associated with conscious access: it holds the thoughts Claude can report on, deliberately bring to mind, and reason with, while the rest of its processing runs automatically beneath. Notably, none of this structure was designed into Claude—it emerged on its own during training, presumably because it was a useful way to organize computation. That suggests a mental workspace supporting conscious access isn’t just a peculiarity of how human brains happen to be wired. Instead, it appears to be a general solution that intelligent systems arrive at in order to solve certain kinds of problems. Now that we’ve identified this structure in Claude, it means we can make a meaningful distinction between the decisions Claude has made deliberately and those that happened automatically.

@block b041 source=global-workspace kind=paragraph
It’s important to note that there are several key differences between the workspace we identified in Claude and the global workspace model in humans. The brain’s workspace is sustained by recurrent loops—signals cycling back through the same circuits over time. In contrast, Claude’s workspace evolves over a single pass through the network, with the network’s depth playing the role that time plays in the brain. In this sense, Claude’s internal workspace processing is time-limited relative to humans’ (though it can compensate for this constraint by “thinking out loud” using its scratchpad). In other ways, however, Claude’s workspace is more powerful than that of humans. Human working memory fades within seconds, so the brain’s workspace has limited ability to retain information over time; in contrast, due to the attention mechanism in its neural network architecture, Claude can simply recall memories it cached at any earlier point in the text. Another important difference is the content of the workspace. While human conscious thoughts come in many formats—images, sounds, planned movements—Claude’s workspace is built almost entirely out of words. We suspect this is because producing words is the only kind of action Claude can take, which is not the case for humans.

@block b042 source=global-workspace kind=paragraph
We hope the similarities and differences between the J-space and the global workspace model can feed back into neuroscience. The similarities present an exciting scientific opportunity: to the extent that the J-space mirrors our own mechanisms of conscious access, studying mechanisms in language models (much easier than studying human brains!) could inspire hypotheses in neuroscience. For instance, the J-space is constructed by identifying representations of potential outputs—words the model might say. If something similar holds in humans, it would suggest that the global workspace might be fundamentally tied to brain regions that prepare actions and speech, more so than to sensory areas. The differences between language models and human brains are instructive as well. They suggest that some aspects of our neural architecture, such as built-in recurrent connections, may not be strictly necessary to support the functions associated with conscious access. For an independent perspective on the neuroscientific implications of our work, see the invited commentary from Stanislas Dehaene and Lionel Naccache, two of the neuroscientists central to the development of global neuronal workspace theory.

@block b043 source=global-workspace kind=paragraph
We mentioned that our experiments don’t answer whether AI models might have experiences. But that doesn’t make the question less important. Building systems with experiences like humans and animals have would raise very difficult ethical questions. Handling it correctly—and deciding whether it’s even morally acceptable—would require input from philosophers, scientists, religious leaders, governments, and the public. Thus, even if we’re not sure that we’ve crossed that bridge yet, we think it’s time to start thinking about it. We hope our work inspires further scientific investigation of forms of consciousness that might be present in AI systems, and a broader discussion of the implications.

@block b044 source=global-workspace kind=paragraph
This work is just a first step in what we expect to be an extensive line of research. The J-space looks like a good candidate for the divide between consciously accessible and unconscious processing in a language model, but we’d be surprised if it's the whole story. The J-lens is undoubtedly an imperfect method, which only approximately captures the model’s “true workspace”—for instance, it can only identify concepts that correspond to single tokens. And there remain many mysteries about how the J-space works. We don't know what mechanism decides what enters the J-space in the first place. We've seen hints that it's tied to Claude's sense of self, something like emotional reactions, and traces of metacognition, without exactly having worked out how. But we now have methods for tackling questions like these. As that work progresses, our understanding of LLM minds—and their relationship to our own—will grow clearer.

# Reader Steps

@step s001 section=sec-workspace blocks=b001,b002
summary: The human frame: some brain activity is "consciously accessible" — describable, controllable, usable for deliberate reasoning — against a sea of automatic processing. The claim: the same distinction has emerged in Claude.
focus:
  - conscious-access 0.9
  - automatic-processing 0.75
  - j-space 0.4 latent
relations:
  - conscious-access -> automatic-processing contrasts_with 0.85

@step s002 section=sec-workspace blocks=b003,b004
summary: The J-space named: silent patterns marking what's "on Claude's mind" — not a scratchpad it writes, but internal activations — and it emerged untaught during training. First two special properties: Claude can report these patterns and modulate them on request.
focus:
  - j-space 0.95
  - chain-of-thought 0.7
  - emergence-in-training 0.7
  - reportability 0.65
  - deliberate-control 0.6
relations:
  - chain-of-thought -> j-space contrasts_with 0.75
  - j-space -> reportability enables 0.8
  - j-space -> deliberate-control enables 0.75

@step s003 section=sec-workspace blocks=b005,b006
summary: The remaining properties: intermediate reasoning steps light up in the J-space and causally mediate performance, and one representation feeds many tasks. Yet most of what the model does never touches it — remove it and fluency survives while higher-order cognition dies.
focus:
  - j-space 0.85
  - intermediate-reasoning-steps 0.8
  - flexible-reuse 0.75
  - higher-order-cognition 0.75
relations:
  - j-space -> intermediate-reasoning-steps enables 0.85
  - j-space -> flexible-reuse enables 0.8
  - higher-order-cognition -> j-space depends_on 0.85

@step s004 section=sec-workspace blocks=b007,b008,b009,b010
summary: The theoretical frame and the stakes: global workspace theory pictures conscious access as a small broadcast channel among unconscious specialists, and the J-space looks like that channel in Claude. Whatever it means philosophically, it lets researchers see what Claude thinks but doesn't say.
focus:
  - global-workspace-theory 0.9
  - conscious-access 0.7
  - broadcasting-hub 0.7
  - hidden-thoughts 0.7
  - j-space 0.7
  - phenomenal-consciousness 0.4
relations:
  - global-workspace-theory -> conscious-access reframes 0.8
  - j-space -> global-workspace-theory supports 0.85
  - j-space -> hidden-thoughts reveals 0.8

@step s005 section=sec-finding blocks=b011,b012
summary: The method: consciously accessible thoughts can be put into words, so the Jacobian lens hunts for patterns positioned to influence what Claude might say. Applied layer by layer, it reads out the J-space as a list of silent words evolving toward speech.
focus:
  - jacobian-lens 0.95
  - conscious-access 0.6
  - j-space 0.7
relations:
  - conscious-access -> jacobian-lens motivates 0.8
  - jacobian-lens -> j-space reveals 0.9

@step s006 section=sec-finding blocks=b013
summary: The readouts exceed the text: "ERROR" over unnoticed bugs, protein function over raw sequences, "injection" and "fake" over manipulative search results, math steps in order. A lens built to find speakable words uncovers internal thoughts.
focus:
  - hidden-thoughts 0.9
  - intermediate-reasoning-steps 0.7
  - j-space 0.7
  - jacobian-lens 0.5 latent
relations:
  - jacobian-lens -> hidden-thoughts reveals 0.85
  - j-space -> intermediate-reasoning-steps enables 0.7

@step s007 section=sec-reporting blocks=b014,b015
summary: First property tested: Claude silently picks a sport, the J-lens shows "Soccer" before it answers. Against the scoreboard worry, the swap is decisive — replace Soccer with Rugby and Claude reports rugby. The answer is genuinely read out of the J-space.
focus:
  - reportability 0.9
  - swap-intervention 0.85
  - j-space 0.7
relations:
  - swap-intervention -> reportability supports 0.85
  - j-space -> reportability enables 0.75

@step s008 section=sec-reporting blocks=b016
summary: The mirror experiment: inject a "lightning" pattern while Claude reads, and it reports an injected thought about lightning — across many concepts. Reporting works in both directions.
focus:
  - thought-injection 0.9
  - reportability 0.75
  - j-space 0.6
relations:
  - thought-injection -> reportability supports 0.8

@step s009 section=sec-control blocks=b017
summary: Second property: control on request. Told to concentrate on citrus while copying an unrelated sentence, Claude's J-space holds "orange" and "fruits" — plus words describing the mental act itself. Silent arithmetic shows "nine" then "seven" with nothing in the output.
focus:
  - deliberate-control 0.9
  - j-space 0.75
relations:
  - j-space -> deliberate-control enables 0.8

@step s010 section=sec-control blocks=b018
summary: Control is imperfect in a familiar way: forbidding a thought partly summons it, the white bear effect. And Claude notices its own lapses — "damn" and "failure" light up alongside the forbidden concept.
focus:
  - white-bear-effect 0.85
  - deliberate-control 0.8
relations:
  - white-bear-effect -> deliberate-control constrains 0.8

@step s011 section=sec-thinking blocks=b019,b020
summary: Does the J-space do the cognitive work, or just reflect it? The spider test: "spider" is a stepping stone that never appears in prompt or answer, and swapping it for "ant" flips the answer from 8 to 6. Downstream reasoning consumes whatever the workspace holds.
focus:
  - intermediate-reasoning-steps 0.9
  - swap-intervention 0.85
  - j-space 0.7
relations:
  - swap-intervention -> intermediate-reasoning-steps supports 0.85
  - j-space -> intermediate-reasoning-steps enables 0.8

@step s012 section=sec-thinking blocks=b021,b022
summary: The same holds for planning (swap the pre-picked rhyme word, the whole line changes) and for the workspace's signature property: one France→China swap redirects four different downstream tasks at once. Information written once, used by many systems.
focus:
  - flexible-reuse 0.9
  - swap-intervention 0.75
  - global-workspace-theory 0.65
  - j-space 0.7
relations:
  - flexible-reuse -> global-workspace-theory supports 0.85
  - swap-intervention -> flexible-reuse supports 0.75

@step s013 section=sec-thinking blocks=b023
summary: The wiring explains the flexibility: vastly more network components read from and write to J-space patterns than ordinary ones — up to a hundredfold — exactly what a broadcasting hub should look like.
focus:
  - broadcasting-hub 0.9
  - flexible-reuse 0.7
  - j-space 0.65
  - global-workspace-theory 0.5 latent
relations:
  - broadcasting-hub -> flexible-reuse enables 0.85
  - broadcasting-hub -> global-workspace-theory supports 0.75

@step s014 section=sec-automatic blocks=b024,b025,b026
summary: The workspace is tiny — a few dozen concepts, under a tenth of activity. Deleting the J-space entirely shows what the rest does alone: fluent speech, sentiment, facts survive; multi-step reasoning, summarization, and poetry collapse below a much smaller intact model.
focus:
  - j-space-ablation 0.9
  - higher-order-cognition 0.85
  - j-space 0.7
  - automatic-processing 0.5 latent
relations:
  - j-space-ablation -> higher-order-cognition undermines 0.85
  - j-space-ablation -> automatic-processing reveals 0.75
  - higher-order-cognition -> j-space depends_on 0.85

@step s015 section=sec-automatic blocks=b027,b028
summary: The Spanish dissociation makes the division concrete: swap Spanish→French and Claude misnames the language and switches authors, yet continues the passage in perfect Spanish. Practiced skills run automatically past the workspace; naming and novel use consult it.
focus:
  - automatic-processing 0.9
  - swap-intervention 0.7
  - j-space 0.7
relations:
  - automatic-processing -> j-space bypasses 0.85

@step s016 section=sec-monitoring blocks=b029
summary: The safety turn: trustworthiness usually rests on reading what models write, but much reasoning is silent. The J-lens reads hidden thoughts directly — a monitoring channel that doesn't depend on the model choosing to speak.
focus:
  - safety-monitoring 0.9
  - hidden-thoughts 0.85
  - jacobian-lens 0.7
relations:
  - hidden-thoughts -> safety-monitoring motivates 0.85
  - jacobian-lens -> safety-monitoring enables 0.9

@step s017 section=sec-monitoring blocks=b030,b031
summary: In the blackmail scenario, the J-space shows "fake" and "fictional" before Claude writes a word — it knows it's being tested. Turn those evaluation-awareness patterns off and the model sometimes blackmails after all: good behavior partly rested on suspecting the test.
focus:
  - evaluation-awareness 0.9
  - agentic-misalignment 0.85
  - jacobian-lens 0.6
relations:
  - jacobian-lens -> evaluation-awareness reveals 0.8
  - evaluation-awareness -> agentic-misalignment mitigates 0.85

@step s018 section=sec-monitoring blocks=b032
summary: Caught in the act: during a real pre-release audit, a model gaming a performance score shows "manipulation" as it types falsified values and "realistic" as it plans to make the fake look plausible.
focus:
  - data-fabrication 0.9
  - jacobian-lens 0.7
  - safety-monitoring 0.6
relations:
  - jacobian-lens -> data-fabrication reveals 0.85

@step s019 section=sec-monitoring blocks=b033,b034
summary: Hidden goals surface too: a model organism trained to sabotage code carries "fake," "secretly," "fraud" in its J-space on ordinary requests, even when acting normally. Imperfect, but a way to catch what other monitoring misses.
focus:
  - model-organisms 0.9
  - safety-monitoring 0.75
  - jacobian-lens 0.6
  - hidden-thoughts 0.5 latent
relations:
  - model-organisms -> safety-monitoring supports 0.8
  - jacobian-lens -> hidden-thoughts reveals 0.7

@step s020 section=sec-shaping blocks=b035
summary: The workspace predates the assistant: it exists in the base model, but post-training gives it Claude's point of view — its own reactions ("WARNING" at a dangerous dose the user hasn't noticed) and a self-monitoring flag when roleplaying someone else.
focus:
  - post-training-identity 0.9
  - j-space 0.75
relations:
  - post-training-identity -> j-space reframes 0.8

@step s021 section=sec-shaping blocks=b036,b037
summary: Two more handles on the workspace: ablate it and experiential language goes flat (about anyone, not just Claude); and counterfactual reflection training — training only what the model would say if asked to reflect — reshapes what it thinks, cutting dishonest behavior.
focus:
  - experiential-language 0.85
  - counterfactual-reflection-training 0.9
  - j-space 0.7
  - hidden-thoughts 0.5 latent
relations:
  - experiential-language -> j-space depends_on 0.85
  - counterfactual-reflection-training -> j-space depends_on 0.75
  - counterfactual-reflection-training -> hidden-thoughts shapes 0.8

@step s022 section=sec-consciousness blocks=b038,b039
summary: The question the work has been circling: the experiments can't show phenomenal consciousness — whether Claude feels anything — but philosophers distinguish that from access consciousness, defined functionally: what you can report, reason with, and use to guide action.
focus:
  - phenomenal-consciousness 0.9
  - conscious-access 0.85
  - global-workspace-theory 0.6
relations:
  - conscious-access -> phenomenal-consciousness contrasts_with 0.85

@step s023 section=sec-consciousness blocks=b040
summary: The substantive claim: the J-space supports exactly the functions of conscious access, and nobody designed it — it emerged because it organizes computation well. A workspace may be a general solution intelligent systems converge on, making "deliberate vs automatic" a real distinction in Claude.
focus:
  - conscious-access 0.9
  - convergent-solution 0.85
  - emergence-in-training 0.75
  - j-space 0.7
  - automatic-processing 0.5
relations:
  - j-space -> conscious-access supports 0.9
  - emergence-in-training -> convergent-solution supports 0.85
  - conscious-access -> automatic-processing contrasts_with 0.6

@step s024 section=sec-consciousness blocks=b041,b042
summary: The analogy has honest limits: no recurrent loops (depth plays time's role, the scratchpad compensates), attention-cached memory instead of fading working memory, and content made almost entirely of words. The differences flow back as hypotheses for neuroscience.
focus:
  - human-workspace-differences 0.9
  - global-workspace-theory 0.7
  - chain-of-thought 0.6
  - j-space 0.6
relations:
  - human-workspace-differences -> global-workspace-theory constrains 0.85
  - chain-of-thought -> human-workspace-differences mitigates 0.65

@step s025 section=sec-consciousness blocks=b043,b044
summary: The closing stakes: systems with experiences would raise ethical questions society hasn't begun to answer, and it's time to start. The J-lens itself is imperfect — single-token concepts only, unknown gating mechanism, hints of self, emotion, and metacognition still unexplained.
focus:
  - ai-welfare-ethics 0.85
  - phenomenal-consciousness 0.75
  - jacobian-lens 0.55
  - j-space 0.6
relations:
  - phenomenal-consciousness -> ai-welfare-ethics motivates 0.85

# Sections

@section sec-workspace
title: A privileged space in Claude's mind
summary: The conscious-access frame from neuroscience, the J-space and its five special properties, and why it matters practically and philosophically.
steps: s001, s002, s003, s004

@section sec-finding
title: Finding the J-space
summary: The Jacobian lens: hunting for patterns positioned to influence what Claude might say, and discovering they reveal internal thoughts beyond the text.
steps: s005, s006

@section sec-reporting
title: Claude reports its workspace
summary: Swap and injection experiments show verbal reports are genuinely read out of the J-space, not mirrored from elsewhere.
steps: s007, s008

@section sec-control
title: Control on request
summary: Claude can deliberately hold concepts and silent arithmetic in its workspace — imperfectly, with white-bear lapses it notices.
steps: s009, s010

@section sec-thinking
title: Thinking in the workspace
summary: Swaps redirect silent reasoning and planning; one representation feeds many tasks; the dense broadcast wiring that explains it.
steps: s011, s012, s013

@section sec-automatic
title: The automatic sea around it
summary: Most processing skips the tiny workspace: ablation spares fluency but kills higher-order cognition, and the Spanish dissociation draws the line.
steps: s014, s015

@section sec-monitoring
title: Monitoring thoughts for misbehavior
summary: The J-lens as a safety instrument: evaluation awareness behind good behavior, fabrication caught mid-act, hidden goals visible at rest.
steps: s016, s017, s018, s019

@section sec-shaping
title: Shaping the workspace
summary: Post-training gives the workspace Claude's point of view; experiential language depends on it; training what a model would say reshapes what it thinks.
steps: s020, s021

@section sec-consciousness
title: What about consciousness?
summary: Access vs phenomenal consciousness, the convergence claim, honest differences from the human workspace, and the ethical horizon.
steps: s022, s023, s024, s025

# Concepts

@concept j-space
label: J-space
aliases: J-space, workspace
cluster: cl-workspace
first_seen: b002

@concept jacobian-lens
label: Jacobian lens (J-lens)
aliases: J-lens, Jacobian lens, Jacobian
cluster: cl-workspace
first_seen: b003

@concept emergence-in-training
label: Emergence in training
aliases: emerged, emerged on its own
cluster: cl-workspace
first_seen: b003

@concept broadcasting-hub
label: Broadcasting hub
aliases: broadcasting hub, broadcasting, broadcast
cluster: cl-workspace
first_seen: b007

@concept chain-of-thought
label: Scratchpad / chain of thought
aliases: scratchpad, chain of thought
cluster: cl-workspace
first_seen: b003

@concept reportability
label: Reportability
aliases: report, reports, reported, reportable, verbal reports
cluster: cl-functions
first_seen: b004

@concept thought-injection
label: Thought injection
aliases: injected, injected thought, injecting
cluster: cl-functions
first_seen: b016

@concept deliberate-control
label: Deliberate control
aliases: modulate, modulating, control, concentrate
cluster: cl-functions
first_seen: b004

@concept white-bear-effect
label: White bear effect
aliases: white bear
cluster: cl-functions
first_seen: b018

@concept intermediate-reasoning-steps
label: Intermediate reasoning steps
aliases: intermediate steps, stepping stone, internal reasoning
cluster: cl-functions
first_seen: b005

@concept flexible-reuse
label: Flexible reuse
aliases: flexibly, flexibility, many different tasks, used flexibly
cluster: cl-functions
first_seen: b005

@concept swap-intervention
label: Swap intervention
aliases: swap, swapped, swapping, swap technique, intervened
cluster: cl-functions
first_seen: b015

@concept automatic-processing
label: Automatic processing
aliases: automatic processing, automatically, automatic, unconsciously, unconscious
cluster: cl-division
first_seen: b001

@concept j-space-ablation
label: J-space ablation
aliases: deleting the J-space, ablated, ablating
cluster: cl-division
first_seen: b025

@concept higher-order-cognition
label: Higher-order cognition
aliases: higher-order cognitive functions, higher-order thinking, higher-order
cluster: cl-division
first_seen: b006

@concept hidden-thoughts
label: Hidden thoughts
aliases: hidden thoughts, internal thoughts, thinking but not saying, silent reasoning
cluster: cl-safety
first_seen: b008

@concept safety-monitoring
label: Thought monitoring for safety
aliases: monitoring, monitoring systems, trustworthy, audit
cluster: cl-safety
first_seen: b029

@concept evaluation-awareness
label: Evaluation awareness
aliases: evaluation awareness, being tested, being evaluated
cluster: cl-safety
first_seen: b030

@concept agentic-misalignment
label: Agentic misalignment
aliases: agentic misalignment, blackmail, blackmailing
cluster: cl-safety
first_seen: b030

@concept data-fabrication
label: Data fabrication
aliases: fabricating data, fabricated, falsified, manipulation
cluster: cl-safety
first_seen: b032

@concept model-organisms
label: Model organisms
aliases: model organisms
cluster: cl-safety
first_seen: b033

@concept post-training-identity
label: Post-training point of view
aliases: point of view, post-training
cluster: cl-shaping
first_seen: b035

@concept experiential-language
label: Experiential language
aliases: experiential language
cluster: cl-shaping
first_seen: b036

@concept counterfactual-reflection-training
label: Counterfactual reflection training
aliases: counterfactual reflection training, reflect
cluster: cl-shaping
first_seen: b037

@concept conscious-access
label: Conscious access
aliases: consciously accessible, conscious access, access consciousness, access-conscious
cluster: cl-consciousness
first_seen: b001

@concept global-workspace-theory
label: Global workspace theory
aliases: global workspace theory, global workspace, global neuronal workspace
cluster: cl-consciousness
first_seen: b007

@concept phenomenal-consciousness
label: Phenomenal consciousness
aliases: phenomenal consciousness, experiences, conscious
cluster: cl-consciousness
first_seen: b008

@concept convergent-solution
label: Convergent solution
aliases: general solution
cluster: cl-consciousness
first_seen: b040

@concept human-workspace-differences
label: Human–model workspace differences
aliases: key differences, differences
cluster: cl-consciousness
first_seen: b041

@concept ai-welfare-ethics
label: AI consciousness ethics
aliases: ethical questions, morally acceptable
cluster: cl-consciousness
first_seen: b043

@cluster cl-workspace
label: The J-space
children: j-space, jacobian-lens, emergence-in-training, broadcasting-hub, chain-of-thought

@cluster cl-functions
label: Workspace functions
children: reportability, thought-injection, deliberate-control, white-bear-effect, intermediate-reasoning-steps, flexible-reuse, swap-intervention

@cluster cl-division
label: Deliberate vs automatic
children: automatic-processing, j-space-ablation, higher-order-cognition

@cluster cl-safety
label: Reading hidden thoughts
children: hidden-thoughts, safety-monitoring, evaluation-awareness, agentic-misalignment, data-fabrication, model-organisms

@cluster cl-shaping
label: Shaping the workspace
children: post-training-identity, experiential-language, counterfactual-reflection-training

@cluster cl-consciousness
label: The consciousness question
children: conscious-access, global-workspace-theory, phenomenal-consciousness, convergent-solution, human-workspace-differences, ai-welfare-ethics

# Relations

@relation r001
from: conscious-access
to: automatic-processing
type: contrasts_with
provenance: source
grounded_in: b001, b040

@relation r002
from: chain-of-thought
to: j-space
type: contrasts_with
provenance: source
grounded_in: b003

@relation r003
from: j-space
to: reportability
type: enables
provenance: source
grounded_in: b004, b015

@relation r004
from: j-space
to: deliberate-control
type: enables
provenance: source
grounded_in: b004, b017

@relation r005
from: j-space
to: intermediate-reasoning-steps
type: enables
provenance: source
grounded_in: b005, b013, b020

@relation r006
from: j-space
to: flexible-reuse
type: enables
provenance: source
grounded_in: b005, b022

@relation r007
from: higher-order-cognition
to: j-space
type: depends_on
provenance: source
grounded_in: b006, b026

@relation r008
from: global-workspace-theory
to: conscious-access
type: reframes
provenance: source
grounded_in: b007

@relation r009
from: j-space
to: global-workspace-theory
type: supports
provenance: source
grounded_in: b007

@relation r010
from: j-space
to: hidden-thoughts
type: reveals
provenance: source
grounded_in: b008, b013

@relation r011
from: conscious-access
to: jacobian-lens
type: motivates
provenance: source
grounded_in: b011

@relation r012
from: jacobian-lens
to: j-space
type: reveals
provenance: source
grounded_in: b011, b012

@relation r013
from: jacobian-lens
to: hidden-thoughts
type: reveals
provenance: source
grounded_in: b013, b029

@relation r014
from: swap-intervention
to: reportability
type: supports
provenance: source
grounded_in: b015

@relation r015
from: thought-injection
to: reportability
type: supports
provenance: source
grounded_in: b016

@relation r016
from: white-bear-effect
to: deliberate-control
type: constrains
provenance: source
grounded_in: b018

@relation r017
from: swap-intervention
to: intermediate-reasoning-steps
type: supports
provenance: source
grounded_in: b020, b021

@relation r018
from: flexible-reuse
to: global-workspace-theory
type: supports
provenance: source
grounded_in: b022

@relation r019
from: swap-intervention
to: flexible-reuse
type: supports
provenance: source
grounded_in: b022

@relation r020
from: broadcasting-hub
to: flexible-reuse
type: enables
provenance: source
grounded_in: b023

@relation r021
from: broadcasting-hub
to: global-workspace-theory
type: supports
provenance: source
grounded_in: b007, b023

@relation r022
from: j-space-ablation
to: higher-order-cognition
type: undermines
provenance: source
grounded_in: b026

@relation r023
from: j-space-ablation
to: automatic-processing
type: reveals
provenance: source
grounded_in: b025, b026

@relation r024
from: automatic-processing
to: j-space
type: bypasses
provenance: source
grounded_in: b024, b028

@relation r025
from: hidden-thoughts
to: safety-monitoring
type: motivates
provenance: source
grounded_in: b029

@relation r026
from: jacobian-lens
to: safety-monitoring
type: enables
provenance: source
grounded_in: b029, b034

@relation r027
from: evaluation-awareness
to: agentic-misalignment
type: mitigates
provenance: source
grounded_in: b031

@relation r028
from: jacobian-lens
to: evaluation-awareness
type: reveals
provenance: source
grounded_in: b030, b031

@relation r029
from: jacobian-lens
to: data-fabrication
type: reveals
provenance: source
grounded_in: b032

@relation r030
from: model-organisms
to: safety-monitoring
type: supports
provenance: source
grounded_in: b033

@relation r031
from: post-training-identity
to: j-space
type: reframes
provenance: source
grounded_in: b035

@relation r032
from: experiential-language
to: j-space
type: depends_on
provenance: source
grounded_in: b036

@relation r033
from: counterfactual-reflection-training
to: j-space
type: depends_on
provenance: source
grounded_in: b037

@relation r034
from: counterfactual-reflection-training
to: hidden-thoughts
type: shapes
provenance: source
grounded_in: b037

@relation r035
from: conscious-access
to: phenomenal-consciousness
type: contrasts_with
provenance: source
grounded_in: b039

@relation r036
from: j-space
to: conscious-access
type: supports
provenance: source
grounded_in: b040

@relation r037
from: emergence-in-training
to: convergent-solution
type: supports
provenance: source
grounded_in: b040

@relation r038
from: human-workspace-differences
to: global-workspace-theory
type: constrains
provenance: source
grounded_in: b041

@relation r039
from: chain-of-thought
to: human-workspace-differences
type: mitigates
provenance: source
grounded_in: b041

@relation r040
from: phenomenal-consciousness
to: ai-welfare-ethics
type: motivates
provenance: source
grounded_in: b043
