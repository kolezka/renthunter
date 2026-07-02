<script lang="ts">
  import { labelSpan, control } from "./styles";

  let { appriseText = $bindable() }: { appriseText: string } = $props();
</script>

<label class="grid gap-[7px]">
  <span class={labelSpan}>Apprise URLs <em class="font-medium not-italic text-ink-3">· one per line</em></span>
  <textarea bind:value={appriseText} rows="5" placeholder={"discord://…\ntgram://…\nntfy://…"} class="{control} resize-y leading-normal"></textarea>
</label>
