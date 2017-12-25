<template>
  <div class="web-view">
  </div>
</template>

<script>
  export default {
    name: 'web-view',
    methods: {
      open(link) {
        this.$electron.shell.openExternal(link);
      },
    },
  };
</script>

<style>

</style>