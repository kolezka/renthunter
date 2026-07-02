<script lang="ts">
  import { control, labelSpan } from "./styles";

  let {
    value = $bindable(),
    models = [],
    label,
    placeholder = "",
  }: { value: string; models?: string[]; label: string; placeholder?: string } = $props();

  const uid = $props.id();
  const listId = uid + "-models";
  const stale = $derived(models.length > 0 && value.trim() !== "" && !models.includes(value.trim()));
</script>

<label class="grid gap-[7px]">
  <span class={labelSpan}>
    {label}
    {#if stale}<em class="font-medium not-italic text-bad">· not in proxy list</em>{/if}
  </span>
  <input type="text" maxlength="120" bind:value list={models.length ? listId : undefined} {placeholder} class={control} />
  {#if models.length}
    <datalist id={listId}>
      {#each models as m (m)}<option value={m}></option>{/each}
    </datalist>
  {/if}
</label>
