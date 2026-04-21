// Example module for ProtoForge Kilo Node
module.exports = {
  init: async function(kiloInstance) {
    console.log('Example module initialized');
    
    // Register a listener for events from Cascade
    kiloInstance.listen((event) => {
      if (event.type === 'example_trigger') {
        console.log('Example module processing event:', event);
        // Process the event here
      }
    });
  },
  
  process: function(data) {
    // Example processing function
    return {
      processed: true,
      data: data,
      timestamp: new Date().toISOString(),
      module: 'example'
    };
  }
};
